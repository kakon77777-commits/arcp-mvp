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
import { FakeMonotonicClock, fixedProvenanceClock } from '../helpers/fake-clocks.js';

const now = { instant_id: 'local:unverified:phase5-model-budget', unverified: true } as const;
const wake: WakeRecord = {
  schema: 'arcp/wake/0.1',
  wake_id: 'wake:phase5:model-budget',
  trigger_type: 'human',
  trigger_ref: 'human:neo',
  required_authority: 'human:neo.manual-run',
  revalidate_on_wake: true,
  idempotency_key: 'wake:key:phase5:model-budget',
};

const hydrator: ContextHydratorPort = {
  async hydrate() {
    return { baseManifestVersion: null, contextHash: 'sha256:phase5-context', values: { phase: '5.0A' } };
  },
};

const policy: PolicyPort = {
  evaluate(input: PolicyInput, options = {}) {
    return evaluate(input, { hasValidApproval: options.hasValidApproval });
  },
};

class FixedBudgetProvider implements RunBudgetProviderPort {
  constructor(private readonly spec: RunBudgetSpec) {}
  async resolveBudget(): Promise<RunBudgetSpec> { return structuredClone(this.spec); }
}

describe('Phase 5.0A model-call budget enforcement', () => {
  it('uses truthful budget view, host limits and exact envelope settlement', async () => {
    const store = new InMemoryRunStateStore();
    const model = new DeterministicModelAdapter([
      {
        actionIntents: [],
        stopReason: 'done',
        usage: { inputTokens: 123, outputTokens: 237, costMicros: 456 },
      },
    ]);
    const budget: RunBudgetSpec = {
      ...DEFAULT_BOUNDED_RUN_BUDGET,
      max_turns: 1,
      max_wall_time_ms: 10_000,
      max_model_input_tokens: 5000,
      max_model_output_tokens: 1000,
      max_model_cost_micros: 20_000,
    };
    const monotonicClock = new FakeMonotonicClock(100);
    const engine = new BoundedRunOrchestrator({
      store,
      hydrator,
      model,
      wakeAuthority: new StaticWakeAuthorityResolver([{ requiredAuthority: 'human:neo.manual-run' }]),
      actionAuthority: new StaticActionAuthorityResolver({ grants: [] }),
      policy,
      budgetProvider: new FixedBudgetProvider(budget),
      provenanceClock: fixedProvenanceClock(now),
      monotonicClock,
    });

    const result = await engine.advance({ agentId: 'arcp:agent:phase5', wake, fencingToken: 7 });

    expect(result.run.phase).toBe('completed');
    expect(model.preparations).toHaveLength(1);
    expect(model.executions).toBe(1);
    expect(model.preparations[0]?.limits).toEqual({
      maxInputTokens: 5000,
      maxOutputTokens: 1000,
      maxCostMicros: 20_000,
      maxActiveDurationMs: 10_000,
    });
    expect(model.preparations[0]?.input.budgetView.model_output_tokens).toMatchObject({
      limit: 1000,
      reserved: 1000,
    });

    const view = await store.getBudgetView(result.run.run_id);
    expect(view.turns).toMatchObject({ reserved: 0, consumed: 1 });
    expect(view.model_input_tokens).toMatchObject({ reserved: 0, consumed: 123, released: 4877 });
    expect(view.model_output_tokens).toMatchObject({ reserved: 0, consumed: 237, released: 763 });
    expect(view.model_cost_micros).toMatchObject({ reserved: 0, consumed: 456, released: 19_544 });
  });

  it('never executes the provider when a required hard budget is zero', async () => {
    const store = new InMemoryRunStateStore();
    const model = new DeterministicModelAdapter([
      { actionIntents: [], stopReason: 'should-not-run', usage: { inputTokens: 1, outputTokens: 1, costMicros: 1 } },
    ]);
    const engine = new BoundedRunOrchestrator({
      store,
      hydrator,
      model,
      wakeAuthority: new StaticWakeAuthorityResolver([{ requiredAuthority: 'human:neo.manual-run' }]),
      actionAuthority: new StaticActionAuthorityResolver({ grants: [] }),
      policy,
      budgetProvider: new FixedBudgetProvider({
        ...DEFAULT_BOUNDED_RUN_BUDGET,
        max_model_output_tokens: 0,
      }),
      provenanceClock: fixedProvenanceClock(now),
      monotonicClock: new FakeMonotonicClock(0),
    });

    await expect(engine.advance({ agentId: 'arcp:agent:phase5', wake, fencingToken: 8 }))
      .rejects.toMatchObject({ code: 'model_budget_exhausted' });
    expect(model.executions).toBe(0);
  });
});
