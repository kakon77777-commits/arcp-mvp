import { describe, expect, it } from 'vitest';
import { DeterministicModelAdapter } from '@arcp/adapter-model';
import { evaluate } from '@arcp/policy-engine';
import type { PolicyInput, ResidenceManifest, WakeRecord } from '@arcp/schema';
import {
  BoundedRunOrchestrator,
  DEFAULT_BOUNDED_RUN_BUDGET,
  InMemoryRunStateStore,
  StaticActionAuthorityResolver,
  StaticWakeAuthorityResolver,
  type CanonicalRunCommitInput,
  type CommitPort,
  type ContextHydratorPort,
  type PolicyPort,
  type RunBudgetProviderPort,
} from '@arcp/workflow-core';
import {
  InjectedCrashAfterEffectError,
  RecordingActionExecutor,
} from '../helpers/recording-action-executor.js';

const now = { instant_id: 'local:unverified:crash-reconcile', unverified: true } as const;
const wake: WakeRecord = {
  schema: 'arcp/wake/0.1', wake_id: 'wake:crash:1', trigger_type: 'human', trigger_ref: 'human:neo',
  required_authority: 'human:neo.manual-run', revalidate_on_wake: true, idempotency_key: 'wake:key:crash:1',
};

const hydrator: ContextHydratorPort = {
  async hydrate() { return { baseManifestVersion: null, contextHash: 'sha256:crash-context', values: {} }; },
};
const policy: PolicyPort = {
  evaluate(input: PolicyInput, options = {}) {
    return evaluate(input, { hasValidApproval: options.hasValidApproval });
  },
};
const budget: RunBudgetProviderPort = {
  async resolveBudget() { return { ...DEFAULT_BOUNDED_RUN_BUDGET }; },
};

class RecordingCommitPort implements CommitPort {
  readonly calls: CanonicalRunCommitInput[] = [];
  async commit(input: CanonicalRunCommitInput): Promise<ResidenceManifest> {
    this.calls.push(structuredClone(input));
    return {
      schema: 'arcp/residence-manifest/0.1', agent_id: input.run.agent_id,
      residence_id: 'arcp:residence:test', manifest_version: this.calls.length, parents: [],
      event_cursor: `arcp:event:crash-${this.calls.length}`, root_hash: `sha256:crash-${this.calls.length}`,
      policy_version: 1, lease_fencing_token: input.fencingToken, status: 'active',
    };
  }
}

describe('Phase 4 crash-safe external effect recovery', () => {
  it('reconciles an executing action after crash instead of executing the effect twice', async () => {
    const store = new InMemoryRunStateStore();
    const model = new DeterministicModelAdapter([{
      actionIntents: [{
        action_id: 'action:crash', actor: 'arcp:agent:test', intent: 'resource.write', target: 'resource:data',
        sensitivity: 'P1', risk: 'R1', reversibility: 'reversible', requested_scopes: ['write'],
        idempotency_key: 'action:key:crash', resource_refs: ['resource:data'],
      }],
      stopReason: 'done-after-write', usage: {},
    }]);
    const executor = new RecordingActionExecutor('effect-then-throw', 'none');
    const commit = new RecordingCommitPort();
    const engine = new BoundedRunOrchestrator({
      store, hydrator, model,
      wakeAuthority: new StaticWakeAuthorityResolver([{ requiredAuthority: 'human:neo.manual-run' }]),
      actionAuthority: new StaticActionAuthorityResolver({ grants: [{
        subjectEntityRef: 'arcp:agent:test', resourceRef: 'resource:data', scopes: ['write'],
        source: 'resource-owner-authorized',
      }] }),
      policy, budgetProvider: budget, executor, commit, now: () => now,
    });

    let runId = '';
    await expect(engine.advance({ agentId: 'arcp:agent:test', wake, fencingToken: 21 }))
      .rejects.toBeInstanceOf(InjectedCrashAfterEffectError);
    expect(executor.executeCalls).toHaveLength(1);
    expect(executor.appliedEffects.size).toBe(1);
    runId = executor.executeCalls[0]!.runId;
    const executionId = executor.executeCalls[0]!.executionId;
    const afterCrash = await store.getActionExecution(executionId);
    expect(afterCrash).toMatchObject({ lifecycle_status: 'executing', effect_status: 'not-observed' });

    executor.mode = 'succeed';
    const resumed = await engine.advance({
      agentId: 'arcp:agent:test', wake, fencingToken: 21, runId,
    });

    expect(resumed.run.phase).toBe('completed');
    expect(model.invocations).toHaveLength(1);
    expect(executor.executeCalls).toHaveLength(1);
    expect(executor.reconcileCalls).toHaveLength(1);
    expect(commit.calls).toHaveLength(1);
    const finalExecution = await store.getActionExecution(executionId);
    expect(finalExecution).toMatchObject({
      lifecycle_status: 'canonically-recorded',
      effect_status: 'succeeded',
      reconciliation_status: 'reconciled',
    });
  });
});
