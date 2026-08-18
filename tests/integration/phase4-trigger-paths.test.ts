import { describe, expect, it } from 'vitest';
import { DeterministicModelAdapter } from '@arcp/adapter-model';
import { evaluate } from '@arcp/policy-engine';
import type { PolicyInput, RunBudgetSpec, WakeRecord } from '@arcp/schema';
import {
  BoundedRunOrchestrator,
  DEFAULT_BOUNDED_RUN_BUDGET,
  InMemoryRunStateStore,
  StaticActionAuthorityResolver,
  StaticWakeAuthorityResolver,
  type ContextHydratorPort,
  type PolicyPort,
  type RunBudgetProviderPort,
} from '@arcp/workflow-core';

const agentId = 'arcp:agent:phase4-triggers';
const now = { instant_id: 'local:unverified:phase4-triggers', unverified: true } as const;
const hydrator: ContextHydratorPort = {
  async hydrate() { return { baseManifestVersion: null, contextHash: 'sha256:trigger-context', values: {} }; },
};
const policy: PolicyPort = {
  evaluate(input: PolicyInput, options = {}) { return evaluate(input, { hasValidApproval: options.hasValidApproval }); },
};
const budgetProvider: RunBudgetProviderPort = {
  async resolveBudget(): Promise<RunBudgetSpec> { return { ...DEFAULT_BOUNDED_RUN_BUDGET }; },
};

function wake(trigger_type: WakeRecord['trigger_type'], authority: string, suffix: string): WakeRecord {
  return {
    schema: 'arcp/wake/0.1', wake_id: `wake:${suffix}`, trigger_type, trigger_ref: `${trigger_type}:${suffix}`,
    required_authority: authority, revalidate_on_wake: true, idempotency_key: `wake:key:${suffix}`,
  };
}

function engine(model: DeterministicModelAdapter, authorities: string[]) {
  const store = new InMemoryRunStateStore();
  return new BoundedRunOrchestrator({
    store,
    hydrator,
    model,
    wakeAuthority: new StaticWakeAuthorityResolver(authorities.map((requiredAuthority) => ({ requiredAuthority, agentId }))),
    actionAuthority: new StaticActionAuthorityResolver({ grants: [] }),
    policy,
    budgetProvider,
    now: () => now,
  });
}

describe('Phase 4 standardized trigger paths', () => {
  it('runs an authorized schedule wake as a bounded promptless run', async () => {
    const model = new DeterministicModelAdapter([{ actionIntents: [], stopReason: 'schedule-complete', usage: {} }]);
    const result = await engine(model, ['schedule:daily']).advance({
      agentId, wake: wake('schedule', 'schedule:daily', 'schedule'), fencingToken: 1,
    });
    expect(result.run.phase).toBe('completed');
    expect(result.stopReason).toBe('schedule-complete');
    expect(model.invocations).toHaveLength(1);
  });

  it('denies an untrusted webhook before model execution', async () => {
    const model = new DeterministicModelAdapter([{ actionIntents: [], stopReason: 'must-not-run', usage: {} }]);
    await expect(engine(model, []).advance({
      agentId, wake: wake('webhook', 'webhook:github.project-a', 'webhook'), fencingToken: 1,
    })).rejects.toMatchObject({ code: 'wake_authority_denied' });
    expect(model.invocations).toHaveLength(0);
  });

  it('runs an authorized committed-state trigger through the same WakeRecord contract', async () => {
    const model = new DeterministicModelAdapter([{ actionIntents: [], stopReason: 'state-complete', usage: {} }]);
    const result = await engine(model, ['state-rule:object-updated']).advance({
      agentId, wake: wake('state', 'state-rule:object-updated', 'state'), fencingToken: 1,
    });
    expect(result.run.phase).toBe('completed');
    expect(result.stopReason).toBe('state-complete');
    expect(model.invocations[0]?.wake.trigger_type).toBe('state');
  });
});
