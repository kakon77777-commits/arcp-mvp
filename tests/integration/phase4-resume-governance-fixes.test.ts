import { describe, expect, it } from 'vitest';
import { DeterministicModelAdapter } from '@arcp/adapter-model';
import type { ActionIntent, PolicyInput, PolicyResult, ResidenceManifest, RunBudgetSpec, WakeRecord } from '@arcp/schema';
import {
  BoundedRunOrchestrator,
  DEFAULT_BOUNDED_RUN_BUDGET,
  InMemoryRunStateStore,
  StaticActionAuthorityResolver,
  StaticWakeAuthorityResolver,
  deriveRunId,
  type ActionExecutorPort,
  type CommitPort,
  type ContextHydratorPort,
  type PolicyPort,
  type RunBudgetProviderPort,
} from '@arcp/workflow-core';
import { RecordingActionExecutor } from '../helpers/recording-action-executor.js';

const agentId = 'arcp:agent:phase4-resume-governance';
const now = { instant_id: 'local:unverified:phase4-resume-governance', unverified: true } as const;
const hydrator: ContextHydratorPort = {
  async hydrate() { return { baseManifestVersion: null, contextHash: 'sha256:resume-governance-context', values: {} }; },
};
const budgetProvider: RunBudgetProviderPort = {
  async resolveBudget(): Promise<RunBudgetSpec> { return { ...DEFAULT_BOUNDED_RUN_BUDGET }; },
};

function action(overrides: Partial<ActionIntent> = {}): ActionIntent {
  return {
    action_id: 'action:resume-governance',
    actor: agentId,
    intent: 'resource.write',
    target: 'resource:governed',
    sensitivity: 'P1',
    risk: 'R1',
    reversibility: 'reversible',
    requested_scopes: ['write'],
    idempotency_key: 'action:key:resume-governance',
    resource_refs: ['resource:governed'],
    continuity_impact: 'none',
    ...overrides,
  };
}

/** Returns a fixed sequence of decisions, one per call, holding the last one for any extra calls. */
class SequencedPolicyPort implements PolicyPort {
  private index = 0;
  constructor(private readonly decisions: PolicyResult[]) {}
  evaluate(_input: PolicyInput): PolicyResult {
    const decision = this.decisions[Math.min(this.index, this.decisions.length - 1)]!;
    this.index += 1;
    return decision;
  }
}

function policyResult(decision: PolicyResult['decision']): PolicyResult {
  return { decision, reason: `fixture:${decision}`, risk: 'R1', policy_version: 1 };
}

describe('Phase 4 resume governance fixes', () => {
  it('does not bypass approval when a delayed action resumes into a policy that now requires approval', async () => {
    const store = new InMemoryRunStateStore();
    const proposedAction = action();
    const model = new DeterministicModelAdapter([{ actionIntents: [proposedAction], usage: {} }]);
    const policy = new SequencedPolicyPort([policyResult('delay'), policyResult('request-approval')]);
    let executed = false;
    const executor: ActionExecutorPort = {
      descriptor() { return { executorId: 'executor:resume-governance', idempotencyMode: 'none' }; },
      async execute() { executed = true; return { status: 'succeeded' }; },
      async reconcile() { throw new Error('reconcile must not be needed'); },
    };
    const commit: CommitPort = {
      async commit() { throw new Error('commit must not be reached while approval is pending'); },
    };
    const engine = new BoundedRunOrchestrator({
      store, hydrator, model,
      wakeAuthority: new StaticWakeAuthorityResolver([{ requiredAuthority: 'schedule:resume-governance', agentId }]),
      actionAuthority: new StaticActionAuthorityResolver({
        grants: [{ subjectEntityRef: agentId, resourceRef: 'resource:governed', scopes: ['write'], source: 'self-authorized' }],
      }),
      policy, budgetProvider, executor, commit,
      defaultApprovalParties: ['arcp:agent:approver'],
      now: () => now,
    });
    const wake: WakeRecord = {
      schema: 'arcp/wake/0.1', wake_id: 'wake:resume-governance:1', trigger_type: 'schedule',
      trigger_ref: 'schedule:resume-governance', required_authority: 'schedule:resume-governance',
      revalidate_on_wake: true, idempotency_key: 'wake:key:resume-governance:1',
    };

    const delayed = await engine.advance({ agentId, wake, fencingToken: 1 });
    expect(delayed.run.phase).toBe('waiting');
    expect(delayed.run.stop_reason).toBe('policy-delay');

    const runId = deriveRunId(agentId, wake.idempotency_key);
    const resumed = await engine.advance({ agentId, wake, fencingToken: 1, runId });

    expect(resumed.run.phase).toBe('waiting-approval');
    expect(resumed.pendingApprovalRequestId).toBeDefined();
    expect(executed).toBe(false);
  });

  it('lets a run finish canonicalizing an already-executed effect while contained, instead of getting stuck in "contained" forever', async () => {
    const store = new InMemoryRunStateStore();
    const proposedAction = action({ action_id: 'action:contained-commit-only', idempotency_key: 'action:key:contained-commit-only' });
    const model = new DeterministicModelAdapter([{ actionIntents: [proposedAction], stopReason: 'would-have-completed', usage: {} }]);
    let commitAttempts = 0;
    const executor = new RecordingActionExecutor('succeed', 'none');
    const commit: CommitPort = {
      async commit(input) {
        commitAttempts += 1;
        if (commitAttempts === 1) throw new Error('injected crash between receipt-recorded and canonical commit');
        const manifest: ResidenceManifest = {
          schema: 'arcp/residence-manifest/0.1', agent_id: input.run.agent_id, residence_id: 'residence:contained-commit-only',
          manifest_version: 1, parents: [], event_cursor: 'event:1', root_hash: 'sha256:manifest-1',
          policy_version: 1, lease_fencing_token: input.fencingToken, status: 'active',
        };
        return manifest;
      },
    };
    const engine = new BoundedRunOrchestrator({
      store, hydrator, model,
      wakeAuthority: new StaticWakeAuthorityResolver([{ requiredAuthority: 'schedule:contained-commit-only', agentId }]),
      actionAuthority: new StaticActionAuthorityResolver({
        grants: [{ subjectEntityRef: agentId, resourceRef: 'resource:governed', scopes: ['write'], source: 'self-authorized' }],
      }),
      policy: { evaluate: () => policyResult('allow') },
      budgetProvider, executor, commit, now: () => now,
    });
    const wake: WakeRecord = {
      schema: 'arcp/wake/0.1', wake_id: 'wake:contained-commit-only:1', trigger_type: 'schedule',
      trigger_ref: 'schedule:contained-commit-only', required_authority: 'schedule:contained-commit-only',
      revalidate_on_wake: true, idempotency_key: 'wake:key:contained-commit-only:1',
    };

    await expect(engine.advance({ agentId, wake, fencingToken: 1 })).rejects.toThrow(
      'injected crash between receipt-recorded and canonical commit',
    );
    expect(executor.executeCalls).toHaveLength(1);
    const receiptsAfterCrash = await store.getActionReceipts(deriveRunId(agentId, wake.idempotency_key));
    expect(receiptsAfterCrash).toHaveLength(1);

    await store.appendContainment({
      schema: 'arcp/containment/0.1', containment_id: 'containment:contained-commit-only', agent_id: agentId,
      scope: ['external-action:write'], reason: 'test activates after the crash, before resume',
      authority_source: 'policy-authorized', entered_at: now, expires_at: now, review_required: true,
      exit_conditions: ['review'], status: 'active',
    });

    const runId = deriveRunId(agentId, wake.idempotency_key);
    const resumed = await engine.advance({ agentId, wake, fencingToken: 1, runId });

    expect(executor.executeCalls).toHaveLength(1);
    expect(resumed.manifest).toBeDefined();
    expect(resumed.run.phase).not.toBe('contained');
  });
});
