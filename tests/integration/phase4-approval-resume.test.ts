import { describe, expect, it } from 'vitest';
import { DeterministicModelAdapter } from '@arcp/adapter-model';
import { evaluate } from '@arcp/policy-engine';
import type { PolicyInput, ResidenceManifest, RunBudgetSpec, WakeRecord } from '@arcp/schema';
import {
  BoundedRunOrchestrator,
  DEFAULT_BOUNDED_RUN_BUDGET,
  InMemoryRunStateStore,
  StaticActionAuthorityResolver,
  type CanonicalRunCommitInput,
  type CommitPort,
  type ContextHydratorPort,
  type PolicyPort,
  type RunBudgetProviderPort,
  type WakeAuthorityResolverPort,
} from '@arcp/workflow-core';
import { RecordingActionExecutor } from '../helpers/recording-action-executor.js';

const now = { instant_id: 'local:unverified:approval-resume', unverified: true } as const;

class FixedBudgetProvider implements RunBudgetProviderPort {
  constructor(private readonly spec: RunBudgetSpec) {}
  async resolveBudget(): Promise<RunBudgetSpec> { return structuredClone(this.spec); }
}

class RecordingCommitPort implements CommitPort {
  readonly calls: CanonicalRunCommitInput[] = [];
  async commit(input: CanonicalRunCommitInput): Promise<ResidenceManifest> {
    this.calls.push(structuredClone(input));
    return {
      schema: 'arcp/residence-manifest/0.1',
      agent_id: input.run.agent_id,
      residence_id: 'arcp:residence:test',
      manifest_version: this.calls.length,
      parents: [],
      event_cursor: `arcp:event:phase4-${this.calls.length}`,
      root_hash: `sha256:phase4-${this.calls.length}`,
      policy_version: 1,
      lease_fencing_token: input.fencingToken,
      status: 'active',
    };
  }
}

const hydrator: ContextHydratorPort = {
  async hydrate() {
    return { baseManifestVersion: null, contextHash: 'sha256:approval-context', values: {} };
  },
};

const wakeAuthority: WakeAuthorityResolverPort = {
  async resolveWake({ wake }) {
    const authorized = wake.required_authority === 'human:neo.manual-run' ||
      wake.required_authority.startsWith('approval-resume:');
    return { authorized, reason: authorized ? 'fixture grant' : 'fixture denial', source: wake.required_authority };
  },
};

const policy: PolicyPort = {
  evaluate(input: PolicyInput, options = {}) {
    return evaluate(input, { hasValidApproval: options.hasValidApproval });
  },
};

function firstWake(): WakeRecord {
  return {
    schema: 'arcp/wake/0.1', wake_id: 'wake:approval:first', trigger_type: 'human', trigger_ref: 'human:neo',
    required_authority: 'human:neo.manual-run', revalidate_on_wake: true, idempotency_key: 'wake:key:approval:first',
  };
}

describe('Phase 4 approval waiting and resume', () => {
  it('persists approval wait, releases execution, then resumes the same run with fresh fencing', async () => {
    const store = new InMemoryRunStateStore();
    const model = new DeterministicModelAdapter([{
      actionIntents: [{
        action_id: 'action:approval', actor: 'arcp:agent:test', intent: 'resource.write', target: 'resource:report',
        sensitivity: 'P1', risk: 'R3', reversibility: 'reversible', requested_scopes: ['write'],
        idempotency_key: 'action:key:approval', resource_refs: ['resource:report'],
      }],
      stopReason: 'done-after-approved-action',
      usage: {},
    }]);
    const executor = new RecordingActionExecutor('succeed', 'provider-enforced');
    const commit = new RecordingCommitPort();
    const engine = new BoundedRunOrchestrator({
      store, hydrator, model, wakeAuthority,
      actionAuthority: new StaticActionAuthorityResolver({ grants: [{
        subjectEntityRef: 'arcp:agent:test', resourceRef: 'resource:report', scopes: ['write'],
        source: 'resource-owner-authorized', maxRisk: 'R3',
      }] }),
      policy,
      budgetProvider: new FixedBudgetProvider({ ...DEFAULT_BOUNDED_RUN_BUDGET, max_risk: 'R3' }),
      executor,
      commit,
      defaultApprovalParties: ['entity:neo'],
      now: () => now,
    });

    const first = await engine.advance({ agentId: 'arcp:agent:test', wake: firstWake(), fencingToken: 11 });
    expect(first.run.phase).toBe('waiting-approval');
    expect(first.pendingApprovalRequestId).toBeTruthy();
    expect(executor.executeCalls).toHaveLength(0);
    expect(commit.calls).toHaveLength(0);

    const request = await store.getApprovalRequest(first.pendingApprovalRequestId!);
    expect(request).toMatchObject({ status: 'pending', required_parties: ['entity:neo'] });

    await store.appendApprovalGrant({
      schema: 'arcp/approval-grant/0.1',
      approval_grant_id: 'approval-grant:neo:1',
      approval_request_id: request!.approval_request_id,
      approver_entity_ref: 'entity:neo',
      granted_scope: ['write'],
      granted_at: now,
      idempotency_key: 'approval-grant:key:neo:1',
    });

    const resumeWake: WakeRecord = {
      schema: 'arcp/wake/0.1', wake_id: 'wake:approval:resume', trigger_type: 'state',
      trigger_ref: request!.approval_request_id,
      required_authority: `approval-resume:${request!.approval_request_id}`,
      revalidate_on_wake: true,
      idempotency_key: 'wake:key:approval:resume',
    };
    const resumed = await engine.advance({
      agentId: 'arcp:agent:test', wake: resumeWake, fencingToken: 12, runId: first.run.run_id,
    });

    expect(resumed.run.phase).toBe('completed');
    expect(resumed.run.fencing_token).toBe(12);
    expect(model.invocations).toHaveLength(1);
    expect(executor.executeCalls).toHaveLength(1);
    expect(commit.calls).toHaveLength(1);
    expect(commit.calls[0]?.fencingToken).toBe(12);
  });
});
