import { describe, expect, it } from 'vitest';
import type { RunRecord } from '@arcp/schema';
import {
  DEFAULT_BOUNDED_RUN_BUDGET,
  InMemoryRunStateStore,
} from '@arcp/workflow-core';

const now = { instant_id: 'local:unverified:envelope-unit', unverified: true } as const;

function run(): RunRecord {
  return {
    schema: 'arcp/run/0.1',
    run_id: 'run:envelope:unit',
    agent_id: 'arcp:agent:envelope',
    wake_id: 'wake:envelope:unit',
    wake_idempotency_key: 'wake:key:envelope:unit',
    phase: 'deliberating',
    fencing_token: 3,
    budget_spec: {
      ...DEFAULT_BOUNDED_RUN_BUDGET,
      max_turns: 2,
      max_model_output_tokens: 1000,
    },
    turn_index: 0,
    checkpoint_sequence: 0,
    created_at: now,
    updated_at: now,
  };
}

describe('Phase 5.0A in-memory budget envelopes', () => {
  it('reserves every dimension or none when one requested dimension is over limit', async () => {
    const store = new InMemoryRunStateStore();
    await store.createRunIfAbsent(run());

    await expect(store.reserveBudgetEnvelope({
      runId: run().run_id,
      fencingToken: 3,
      envelopeId: 'envelope:over',
      kind: 'model-call',
      items: [
        { dimension: 'turns', amount: 1 },
        { dimension: 'model_output_tokens', amount: 1001 },
      ],
      reservedAt: now,
    })).rejects.toMatchObject({ code: 'budget_exhausted' });

    const view = await store.getBudgetView(run().run_id);
    expect(view.turns.reserved).toBe(0);
    expect(view.model_output_tokens.reserved).toBe(0);
    expect(await store.getBudgetEnvelope('envelope:over')).toBeNull();
  });

  it('is idempotent for identical envelope content and rejects divergent same-id content', async () => {
    const store = new InMemoryRunStateStore();
    await store.createRunIfAbsent(run());
    const request = {
      runId: run().run_id,
      fencingToken: 3,
      envelopeId: 'envelope:idempotent',
      kind: 'model-call' as const,
      items: [
        { dimension: 'turns' as const, amount: 1 },
        { dimension: 'model_output_tokens' as const, amount: 1000 },
      ],
      reservedAt: now,
    };

    const first = await store.reserveBudgetEnvelope(request);
    const second = await store.reserveBudgetEnvelope(request);
    expect(second).toEqual(first);
    expect((await store.getBudgetView(run().run_id)).turns.reserved).toBe(1);

    await expect(store.reserveBudgetEnvelope({
      ...request,
      items: [{ dimension: 'turns', amount: 1 }],
    })).rejects.toMatchObject({ code: 'budget_envelope_conflict' });
  });

  it('settles all dimensions atomically and never treats a missing actual as zero', async () => {
    const store = new InMemoryRunStateStore();
    await store.createRunIfAbsent(run());
    await store.reserveBudgetEnvelope({
      runId: run().run_id,
      fencingToken: 3,
      envelopeId: 'envelope:settle',
      kind: 'model-call',
      items: [
        { dimension: 'turns', amount: 1 },
        { dimension: 'model_output_tokens', amount: 1000 },
      ],
      reservedAt: now,
    });

    await expect(store.settleBudgetEnvelope({
      runId: run().run_id,
      envelopeId: 'envelope:settle',
      actuals: { turns: 1 },
      settledAt: now,
    })).rejects.toMatchObject({ code: 'budget_envelope_invalid' });

    let view = await store.getBudgetView(run().run_id);
    expect(view.turns.reserved).toBe(1);
    expect(view.model_output_tokens.reserved).toBe(1000);
    expect(view.turns.consumed).toBe(0);

    const settled = await store.settleBudgetEnvelope({
      runId: run().run_id,
      envelopeId: 'envelope:settle',
      actuals: { turns: 1, model_output_tokens: 237 },
      settledAt: now,
    });
    expect(settled.status).toBe('settled');

    view = await store.getBudgetView(run().run_id);
    expect(view.turns).toMatchObject({ reserved: 0, consumed: 1, released: 0 });
    expect(view.model_output_tokens).toMatchObject({ reserved: 0, consumed: 237, released: 763 });
  });
});
