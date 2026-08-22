import { describe, expect, it } from 'vitest';
import { DeterministicModelAdapter } from '@arcp/adapter-model';
import type { PolicyInput, RunBudgetSpec, WakeRecord } from '@arcp/schema';
import { evaluate } from '@arcp/policy-engine';
import {
  BoundedRunOrchestrator,
  DEFAULT_BOUNDED_RUN_BUDGET,
  InMemoryRunStateStore,
  StaticActionAuthorityResolver,
  StaticWakeAuthorityResolver,
  WorkflowError,
  deriveRunId,
  type ContextHydratorPort,
  type PolicyPort,
  type ProvenanceClockPort,
  type RunBudgetProviderPort,
} from '@arcp/workflow-core';
import { FakeMonotonicClock } from '../helpers/fake-clocks.js';

const wake: WakeRecord = {
  schema: 'arcp/wake/0.1',
  wake_id: 'wake:phase5:crash',
  trigger_type: 'human',
  trigger_ref: 'human:neo',
  required_authority: 'human:neo.manual-run',
  revalidate_on_wake: true,
  idempotency_key: 'wake:key:phase5:crash',
};
const agentId = 'arcp:agent:phase5-crash';
const runId = deriveRunId(agentId, wake.idempotency_key);

class MutableProvenanceClock implements ProvenanceClockPort {
  private sequence = 0;
  now() {
    this.sequence += 1;
    return { instant_id: `local:unverified:phase5-crash:${this.sequence}`, unverified: true } as const;
  }
}

class FixedBudgetProvider implements RunBudgetProviderPort {
  constructor(private readonly spec: RunBudgetSpec = {
    ...DEFAULT_BOUNDED_RUN_BUDGET,
    max_turns: 1,
    max_wall_time_ms: 10_000,
    max_model_input_tokens: 100,
    max_model_output_tokens: 50,
    max_model_cost_micros: 500,
  }) {}
  async resolveBudget(): Promise<RunBudgetSpec> { return structuredClone(this.spec); }
}

const hydrator: ContextHydratorPort = {
  async hydrate() {
    return { baseManifestVersion: null, contextHash: 'sha256:phase5-crash-context', values: {} };
  },
};
const policy: PolicyPort = {
  evaluate(input: PolicyInput, options = {}) {
    return evaluate(input, { hasValidApproval: options.hasValidApproval });
  },
};

class FailCallingCasOnceStore extends InMemoryRunStateStore {
  private failed = false;
  override async transitionModelInvocation(...args: Parameters<InMemoryRunStateStore['transitionModelInvocation']>) {
    const [, expectedStatus, next] = args;
    if (!this.failed && expectedStatus === 'reserved' && next.status === 'calling') {
      this.failed = true;
      throw new WorkflowError('invalid_persisted_state', 'simulated crash before durable calling', false);
    }
    return super.transitionModelInvocation(...args);
  }
}

class FailTurnAdvanceOnceStore extends InMemoryRunStateStore {
  private failed = false;
  override async updateRun(...args: Parameters<InMemoryRunStateStore['updateRun']>) {
    const [run] = args;
    if (!this.failed && run.turn_index === 1) {
      this.failed = true;
      throw new WorkflowError('invalid_persisted_state', 'simulated crash after model success', false);
    }
    return super.updateRun(...args);
  }
}

class FailModelEnvelopeSettleOnceStore extends InMemoryRunStateStore {
  private failed = false;
  override async settleBudgetEnvelope(...args: Parameters<InMemoryRunStateStore['settleBudgetEnvelope']>) {
    const [input] = args;
    const envelope = await this.getBudgetEnvelope(input.envelopeId);
    if (!this.failed && envelope?.kind === 'model-call' && envelope.status === 'reserved') {
      this.failed = true;
      throw new WorkflowError(
        'invalid_persisted_state',
        'simulated crash after durable model success before envelope settlement',
        false,
      );
    }
    return super.settleBudgetEnvelope(...args);
  }
}

function engine(store: InMemoryRunStateStore, model: DeterministicModelAdapter, clock: ProvenanceClockPort) {
  return new BoundedRunOrchestrator({
    store,
    hydrator,
    model,
    wakeAuthority: new StaticWakeAuthorityResolver([{ requiredAuthority: 'human:neo.manual-run' }]),
    actionAuthority: new StaticActionAuthorityResolver({ grants: [] }),
    policy,
    budgetProvider: new FixedBudgetProvider(),
    provenanceClock: clock,
    monotonicClock: new FakeMonotonicClock(0),
  });
}

function successfulStep() {
  return {
    actionIntents: [],
    stopReason: 'done',
    usage: { inputTokens: 10, outputTokens: 5, costMicros: 20 },
  };
}

describe('Phase 5.0A model-call crash recovery', () => {
  it('reuses a held reserved invocation after a crash before durable calling without a second reservation', async () => {
    const store = new FailCallingCasOnceStore();
    const model = new DeterministicModelAdapter([successfulStep()]);
    const clock = new MutableProvenanceClock();
    const runtime = engine(store, model, clock);

    await expect(runtime.advance({ agentId, wake, fencingToken: 3 }))
      .rejects.toMatchObject({ code: 'invalid_persisted_state' });
    expect(model.executions).toBe(0);

    const resumed = await runtime.advance({ agentId, wake, fencingToken: 3 });
    expect(resumed.run.phase).toBe('completed');
    expect(model.executions).toBe(1);
    expect((await store.getBudgetView(runId)).model_output_tokens).toMatchObject({ reserved: 0, consumed: 5 });
  });

  it('never retries an ambiguous provider call and conservatively consumes the held model maxima', async () => {
    const store = new InMemoryRunStateStore();
    const model = new DeterministicModelAdapter([
      { error: 'ambiguous', message: 'provider outcome unknown' },
    ]);
    const runtime = engine(store, model, { now: () => ({ instant_id: 'local:fixed:ambiguous', unverified: true }) });

    await expect(runtime.advance({ agentId, wake, fencingToken: 4 })).rejects.toBeTruthy();
    expect(model.executions).toBe(1);
    expect((await store.getBudgetView(runId)).model_output_tokens).toMatchObject({ reserved: 50, consumed: 0 });

    await expect(runtime.advance({ agentId, wake, fencingToken: 4 }))
      .rejects.toMatchObject({ code: 'budget_envelope_recovery_required' });
    expect(model.executions).toBe(1);
    expect((await store.getBudgetView(runId)).model_output_tokens).toMatchObject({ reserved: 0, consumed: 50 });
    expect((await store.getBudgetView(runId)).model_cost_micros).toMatchObject({ reserved: 0, consumed: 500 });
  });

  it('replays a durably succeeded proposal after a crash before turn-index advancement without calling the provider again', async () => {
    const store = new FailTurnAdvanceOnceStore();
    const model = new DeterministicModelAdapter([successfulStep()]);
    const runtime = engine(store, model, { now: () => ({ instant_id: 'local:fixed:succeeded', unverified: true }) });

    await expect(runtime.advance({ agentId, wake, fencingToken: 5 }))
      .rejects.toMatchObject({ code: 'invalid_persisted_state' });
    expect(model.executions).toBe(1);

    const resumed = await runtime.advance({ agentId, wake, fencingToken: 5 });
    expect(resumed.run.phase).toBe('completed');
    expect(resumed.run.turn_index).toBe(1);
    expect(model.executions).toBe(1);
  });

  it('replays a durably succeeded proposal after settlement crashed into recovery-required', async () => {
    const store = new FailModelEnvelopeSettleOnceStore();
    const model = new DeterministicModelAdapter([successfulStep()]);
    const runtime = engine(store, model, { now: () => ({ instant_id: 'local:fixed:settlement-crash', unverified: true }) });

    await expect(runtime.advance({ agentId, wake, fencingToken: 6 }))
      .rejects.toMatchObject({ code: 'invalid_persisted_state' });
    expect(model.executions).toBe(1);
    expect((await store.getBudgetView(runId)).model_output_tokens).toMatchObject({ reserved: 50, consumed: 0 });

    const resumed = await runtime.advance({ agentId, wake, fencingToken: 6 });
    expect(resumed.run.phase).toBe('completed');
    expect(model.executions).toBe(1);
    expect((await store.getBudgetView(runId)).model_output_tokens).toMatchObject({ reserved: 0, consumed: 5 });
    expect((await store.getBudgetView(runId)).model_cost_micros).toMatchObject({ reserved: 0, consumed: 20 });
  });
});
