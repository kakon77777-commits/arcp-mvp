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

const now = { instant_id: 'local:unverified:phase4-orchestrator', unverified: true } as const;

function wake(requiredAuthority = 'human:neo.manual-run'): WakeRecord {
  return {
    schema: 'arcp/wake/0.1',
    wake_id: 'wake:orchestrator:1',
    trigger_type: 'human',
    trigger_ref: 'human:neo',
    required_authority: requiredAuthority,
    revalidate_on_wake: true,
    idempotency_key: 'wake:key:orchestrator:1',
  };
}

const hydrator: ContextHydratorPort = {
  async hydrate() {
    return { baseManifestVersion: null, contextHash: 'sha256:context', values: { fixture: true } };
  },
};

const policy: PolicyPort = {
  evaluate(input: PolicyInput, options = {}) {
    return evaluate(input, { hasValidApproval: options.hasValidApproval });
  },
};

class FixedBudgetProvider implements RunBudgetProviderPort {
  constructor(private readonly spec: RunBudgetSpec) {}
  async resolveBudget(): Promise<RunBudgetSpec> {
    return structuredClone(this.spec);
  }
}

function orchestrator(input: {
  model: DeterministicModelAdapter;
  store?: InMemoryRunStateStore;
  budget?: RunBudgetSpec;
  wakeAuthorities?: string[];
  actionResolver?: StaticActionAuthorityResolver;
}) {
  const store = input.store ?? new InMemoryRunStateStore();
  return {
    store,
    engine: new BoundedRunOrchestrator({
      store,
      hydrator,
      model: input.model,
      wakeAuthority: new StaticWakeAuthorityResolver(
        (input.wakeAuthorities ?? ['human:neo.manual-run']).map((requiredAuthority) => ({ requiredAuthority })),
      ),
      actionAuthority: input.actionResolver ?? new StaticActionAuthorityResolver({ grants: [] }),
      policy,
      budgetProvider: new FixedBudgetProvider(input.budget ?? { ...DEFAULT_BOUNDED_RUN_BUDGET }),
      now: () => now,
    }),
  };
}

describe('Phase 4 bounded run orchestrator', () => {
  it('denies an unauthorized wake before hydration/model execution', async () => {
    const model = new DeterministicModelAdapter([{ actionIntents: [], stopReason: 'unused', usage: {} }]);
    const { engine } = orchestrator({ model, wakeAuthorities: [] });

    await expect(engine.advance({
      agentId: 'arcp:agent:test', wake: wake('webhook:untrusted'), fencingToken: 1,
    })).rejects.toMatchObject({ code: 'wake_authority_denied' });
    expect(model.invocations).toHaveLength(0);
  });

  it('stops at max_turns without calling an additional model turn', async () => {
    const model = new DeterministicModelAdapter([
      { actionIntents: [], usage: { inputTokens: 2, outputTokens: 1 } },
      { actionIntents: [], usage: { inputTokens: 2, outputTokens: 1 } },
      { actionIntents: [], usage: { inputTokens: 2, outputTokens: 1 } },
    ]);
    const { engine } = orchestrator({
      model,
      budget: { ...DEFAULT_BOUNDED_RUN_BUDGET, max_turns: 2 },
    });

    const result = await engine.advance({ agentId: 'arcp:agent:test', wake: wake(), fencingToken: 3 });
    expect(model.invocations).toHaveLength(2);
    expect(result.run.phase).toBe('completed');
    expect(result.run.stop_reason).toBe('budget-exhausted:max-turns');
    expect(result.run.turn_index).toBe(2);
  });

  it('feeds an authority denial into the next deliberation and never treats it as permission', async () => {
    const model = new DeterministicModelAdapter([
      {
        actionIntents: [{
          action_id: 'action:denied', actor: 'arcp:agent:test', intent: 'resource.write', target: 'resource:private',
          sensitivity: 'P1', risk: 'R1', reversibility: 'reversible', requested_scopes: ['write'],
          idempotency_key: 'action:key:denied', resource_refs: ['resource:private'],
        }],
        usage: {},
      },
      { actionIntents: [], stopReason: 'accepted-denial', usage: {} },
    ]);
    const { engine, store } = orchestrator({ model });

    const result = await engine.advance({ agentId: 'arcp:agent:test', wake: wake(), fencingToken: 4 });

    expect(result.run.phase).toBe('completed');
    expect(model.invocations).toHaveLength(2);
    expect(model.invocations[1]?.priorDenials).toHaveLength(1);
    expect(model.invocations[1]?.priorDenials[0]?.status).toBe('denied');
    const resolutions = await store.getAuthorityResolutions(result.run.run_id);
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]?.status).toBe('denied');
  });

  it('enforces the model input-token budget instead of only tracking turns/external-actions', async () => {
    const model = new DeterministicModelAdapter([
      { actionIntents: [], usage: { inputTokens: 900 } },
    ]);
    const { engine } = orchestrator({
      model,
      budget: { ...DEFAULT_BOUNDED_RUN_BUDGET, max_model_input_tokens: 500 },
    });

    await expect(
      engine.advance({ agentId: 'arcp:agent:test', wake: wake(), fencingToken: 5 }),
    ).rejects.toMatchObject({ code: 'budget_exhausted' });
  });
});
