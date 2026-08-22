import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { D1RunStateStore } from '@arcp/adapter-cloudflare';
import type { RunRecord } from '@arcp/schema';
import { DEFAULT_BOUNDED_RUN_BUDGET, InMemoryRunStateStore } from '@arcp/workflow-core';
import { createFakeD1Database } from '../helpers/fake-d1-database.js';

const migration1 = readFileSync(fileURLToPath(new URL('../../migrations/d1/0001_init.sql', import.meta.url)), 'utf-8');
const migration2 = readFileSync(fileURLToPath(new URL('../../migrations/d1/0002_phase4_runs.sql', import.meta.url)), 'utf-8');
const migration3 = readFileSync(fileURLToPath(new URL('../../migrations/d1/0003_phase5_0a_budget_envelopes.sql', import.meta.url)), 'utf-8');
const now = { instant_id: 'local:unverified:envelope-parity', unverified: true } as const;

function run(): RunRecord {
  return {
    schema: 'arcp/run/0.1',
    run_id: 'run:envelope:parity',
    agent_id: 'arcp:agent:envelope-parity',
    wake_id: 'wake:envelope:parity',
    wake_idempotency_key: 'wake:key:envelope:parity',
    phase: 'deliberating',
    fencing_token: 7,
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

describe('Phase 5.0A budget-envelope store parity', () => {
  it('matches reserve and settle semantics across in-memory and D1 stores', async () => {
    const memory = new InMemoryRunStateStore();
    const d1 = new D1RunStateStore(createFakeD1Database(`${migration1}\n${migration2}\n${migration3}`));

    for (const store of [memory, d1]) {
      await store.createRunIfAbsent(run());
      await store.reserveBudgetEnvelope({
        runId: run().run_id,
        fencingToken: 7,
        envelopeId: 'envelope:parity:1',
        kind: 'model-call',
        items: [
          { dimension: 'turns', amount: 1 },
          { dimension: 'model_output_tokens', amount: 1000 },
        ],
        reservedAt: now,
      });
    }

    expect(await d1.getBudgetView(run().run_id)).toEqual(await memory.getBudgetView(run().run_id));
    expect(await d1.getBudgetEnvelope('envelope:parity:1')).toEqual(
      await memory.getBudgetEnvelope('envelope:parity:1'),
    );

    for (const store of [memory, d1]) {
      await store.settleBudgetEnvelope({
        runId: run().run_id,
        envelopeId: 'envelope:parity:1',
        actuals: { turns: 1, model_output_tokens: 237 },
        settledAt: now,
      });
    }

    expect(await d1.getBudgetView(run().run_id)).toEqual(await memory.getBudgetView(run().run_id));
    expect(await d1.getBudgetEnvelope('envelope:parity:1')).toEqual(
      await memory.getBudgetEnvelope('envelope:parity:1'),
    );
  });

  it('rejects stale fencing without creating or reserving an envelope', async () => {
    const d1 = new D1RunStateStore(createFakeD1Database(`${migration1}\n${migration2}\n${migration3}`));
    await d1.createRunIfAbsent(run());

    await expect(d1.reserveBudgetEnvelope({
      runId: run().run_id,
      fencingToken: 6,
      envelopeId: 'envelope:stale',
      kind: 'model-call',
      items: [{ dimension: 'turns', amount: 1 }],
      reservedAt: now,
    })).rejects.toMatchObject({ code: 'stale_fencing_token' });

    expect(await d1.getBudgetEnvelope('envelope:stale')).toBeNull();
    expect((await d1.getBudgetView(run().run_id)).turns.reserved).toBe(0);
  });
});
