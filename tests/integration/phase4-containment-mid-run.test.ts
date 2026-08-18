import { describe, expect, it } from 'vitest';
import { DeterministicModelAdapter } from '@arcp/adapter-model';
import { evaluate } from '@arcp/policy-engine';
import type { ActionIntent, PolicyInput, ResidenceManifest, RunBudgetSpec, WakeRecord } from '@arcp/schema';
import {
  BoundedRunOrchestrator,
  DEFAULT_BOUNDED_RUN_BUDGET,
  InMemoryRunStateStore,
  StaticActionAuthorityResolver,
  StaticWakeAuthorityResolver,
  type ActionExecutorPort,
  type CommitPort,
  type ContextHydratorPort,
  type PolicyPort,
  type RunBudgetProviderPort,
} from '@arcp/workflow-core';

const agentId = 'arcp:agent:phase4-containment';
const now = { instant_id: 'local:unverified:phase4-containment', unverified: true } as const;
const wake: WakeRecord = {
  schema: 'arcp/wake/0.1', wake_id: 'wake:containment:1', trigger_type: 'schedule', trigger_ref: 'schedule:containment',
  required_authority: 'schedule:containment', revalidate_on_wake: true, idempotency_key: 'wake:key:containment:1',
};
const hydrator: ContextHydratorPort = {
  async hydrate() { return { baseManifestVersion: null, contextHash: 'sha256:containment-context', values: {} }; },
};
const policy: PolicyPort = {
  evaluate(input: PolicyInput, options = {}) { return evaluate(input, { hasValidApproval: options.hasValidApproval }); },
};
const budgetProvider: RunBudgetProviderPort = {
  async resolveBudget(): Promise<RunBudgetSpec> { return { ...DEFAULT_BOUNDED_RUN_BUDGET, max_external_actions: 2 }; },
};
function action(id: string, resource: string): ActionIntent {
  return {
    action_id: id, actor: agentId, intent: 'resource.write', target: resource,
    sensitivity: 'P1', risk: 'R1', reversibility: 'reversible', requested_scopes: ['write'],
    idempotency_key: `action:key:${id}`, resource_refs: [resource], continuity_impact: 'none',
  };
}

describe('Phase 4 in-flight containment', () => {
  it('preserves the first receipt/commit and blocks the next external effect after containment activates', async () => {
    const store = new InMemoryRunStateStore();
    const first = action('action:first', 'resource:first');
    const second = action('action:second', 'resource:second');
    const model = new DeterministicModelAdapter([{
      actionIntents: [first, second], stopReason: 'would-have-completed', usage: {},
    }]);
    const executeCalls: string[] = [];
    const executor: ActionExecutorPort = {
      descriptor() { return { executorId: 'executor:containment', idempotencyMode: 'provider-enforced' }; },
      async execute(input) {
        executeCalls.push(input.authorization.action.action_id);
        if (executeCalls.length === 1) {
          await store.appendContainment({
            schema: 'arcp/containment/0.1', containment_id: 'containment:mid-run', agent_id: agentId,
            scope: ['external-action:write'], reason: 'test activates after first effect', authority_source: 'policy-authorized',
            entered_at: now, expires_at: now, review_required: true, exit_conditions: ['review'], status: 'active',
          });
        }
        return { status: 'succeeded', providerOperationId: `provider:${executeCalls.length}` };
      },
      async reconcile() { throw new Error('reconcile must not be needed'); },
    };
    let manifestVersion = 0;
    const commit: CommitPort = {
      async commit(input) {
        manifestVersion += 1;
        const manifest: ResidenceManifest = {
          schema: 'arcp/residence-manifest/0.1', agent_id: input.run.agent_id, residence_id: 'residence:containment',
          manifest_version: manifestVersion, parents: [], event_cursor: `event:${manifestVersion}`,
          root_hash: `sha256:manifest-${manifestVersion}`, policy_version: 1,
          lease_fencing_token: input.fencingToken, status: 'active',
        };
        return manifest;
      },
    };
    const engine = new BoundedRunOrchestrator({
      store, hydrator, model,
      wakeAuthority: new StaticWakeAuthorityResolver([{ requiredAuthority: 'schedule:containment', agentId }]),
      actionAuthority: new StaticActionAuthorityResolver({ grants: [
        { subjectEntityRef: agentId, resourceRef: 'resource:first', scopes: ['write'], source: 'self-authorized' },
        { subjectEntityRef: agentId, resourceRef: 'resource:second', scopes: ['write'], source: 'self-authorized' },
      ] }),
      policy, budgetProvider, executor, commit, now: () => now,
    });

    const result = await engine.advance({ agentId, wake, fencingToken: 1 });

    expect(executeCalls).toEqual(['action:first']);
    expect(result.run.phase).toBe('contained');
    expect(result.run.stop_reason).toBe('containment-active');
    expect(await store.getActionReceipts(result.run.run_id)).toHaveLength(1);
    expect(manifestVersion).toBe(1);
  });
});
