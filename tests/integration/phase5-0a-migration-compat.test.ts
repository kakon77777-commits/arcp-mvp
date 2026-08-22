import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { D1RunStateStore, Phase4D1RunStateStore } from '@arcp/adapter-cloudflare';
import type { ModelInvocationRecord, RunRecord } from '@arcp/schema';
import { DEFAULT_BOUNDED_RUN_BUDGET } from '@arcp/workflow-core';
import { createFakeD1Database } from '../helpers/fake-d1-database.js';

const migration1 = readFileSync(fileURLToPath(new URL('../../migrations/d1/0001_init.sql', import.meta.url)), 'utf-8');
const migration2 = readFileSync(fileURLToPath(new URL('../../migrations/d1/0002_phase4_runs.sql', import.meta.url)), 'utf-8');
const migration3 = readFileSync(fileURLToPath(new URL('../../migrations/d1/0003_phase5_0a_budget_envelopes.sql', import.meta.url)), 'utf-8');
const now = { instant_id: 'local:unverified:migration-compat', unverified: true } as const;

function phase4Run(): RunRecord {
  return {
    schema: 'arcp/run/0.1',
    run_id: 'run:migration:phase4',
    agent_id: 'arcp:agent:migration',
    wake_id: 'wake:migration:phase4',
    wake_idempotency_key: 'wake:key:migration:phase4',
    phase: 'deliberating',
    fencing_token: 9,
    budget_spec: { ...DEFAULT_BOUNDED_RUN_BUDGET, max_turns: 2 },
    turn_index: 0,
    checkpoint_sequence: 0,
    created_at: now,
    updated_at: now,
  };
}

describe('Phase 5.0A migration compatibility', () => {
  it('preserves Phase 4 run/reservation/invocation state while enabling Budget Envelopes', async () => {
    const db = createFakeD1Database(`${migration1}\n${migration2}`);
    const legacy = new Phase4D1RunStateStore(db);
    const run = phase4Run();
    await legacy.createRunIfAbsent(run);
    await legacy.reserveModelBudget(run.run_id, run.fencing_token, {
      reservationId: 'reservation:phase4:turn',
      dimension: 'turns',
      amount: 1,
    });
    const invocation: ModelInvocationRecord = {
      schema: 'arcp/model-invocation/0.1',
      invocation_id: 'invocation:phase4:legacy',
      run_id: run.run_id,
      turn_index: 0,
      status: 'succeeded',
      budget_reservation_id: 'reservation:phase4:turn',
      input_hash: 'sha256:legacy-input',
      output_hash: 'sha256:legacy-output',
      usage: { input_tokens: 10, output_tokens: 5, cost_micros: 20 },
      observed_at: now,
    };
    await legacy.appendModelInvocation(invocation);

    db.exec(migration3);

    const phase5 = new D1RunStateStore(db);
    expect(await phase5.getRun(run.run_id)).toEqual(run);

    const oldInvocation = await db.prepare(
      `SELECT invocation_json, status, budget_envelope_id FROM arcp_model_invocations WHERE invocation_id = ?`,
    ).bind(invocation.invocation_id).first<{
      invocation_json: string;
      status: string | null;
      budget_envelope_id: string | null;
    }>();
    expect(JSON.parse(oldInvocation!.invocation_json)).toEqual(invocation);
    expect(oldInvocation).toMatchObject({ status: 'succeeded', budget_envelope_id: null });

    const oldReservation = await db.prepare(
      `SELECT reservation_id, status FROM arcp_model_budget_reservations WHERE reservation_id = ?`,
    ).bind('reservation:phase4:turn').first<{ reservation_id: string; status: string }>();
    expect(oldReservation).toEqual({ reservation_id: 'reservation:phase4:turn', status: 'reserved' });

    const envelope = await phase5.reserveBudgetEnvelope({
      runId: run.run_id,
      fencingToken: run.fencing_token,
      envelopeId: 'envelope:migration:new',
      kind: 'model-call',
      items: [{ dimension: 'model_output_tokens', amount: 100 }],
      reservedAt: now,
    });
    expect(envelope).toMatchObject({ envelope_id: 'envelope:migration:new', status: 'reserved' });
  });
});
