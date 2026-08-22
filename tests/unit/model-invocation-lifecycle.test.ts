import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { D1RunStateStore } from '@arcp/adapter-cloudflare';
import type { Phase5ModelInvocationRecord, RunRecord } from '@arcp/schema';
import { DEFAULT_BOUNDED_RUN_BUDGET, InMemoryRunStateStore } from '@arcp/workflow-core';
import { createFakeD1Database } from '../helpers/fake-d1-database.js';

const migration1 = readFileSync(fileURLToPath(new URL('../../migrations/d1/0001_init.sql', import.meta.url)), 'utf-8');
const migration2 = readFileSync(fileURLToPath(new URL('../../migrations/d1/0002_phase4_runs.sql', import.meta.url)), 'utf-8');
const migration3 = readFileSync(fileURLToPath(new URL('../../migrations/d1/0003_phase5_0a_budget_envelopes.sql', import.meta.url)), 'utf-8');
const now = { instant_id: 'local:unverified:model-invocation-lifecycle', unverified: true } as const;

function run(): RunRecord {
  return {
    schema: 'arcp/run/0.1', run_id: 'run:model-life', agent_id: 'arcp:agent:model-life',
    wake_id: 'wake:model-life', wake_idempotency_key: 'wake:key:model-life', phase: 'deliberating',
    fencing_token: 1, budget_spec: { ...DEFAULT_BOUNDED_RUN_BUDGET },
    turn_index: 0, checkpoint_sequence: 0, created_at: now, updated_at: now,
  };
}

function reserved(): Phase5ModelInvocationRecord {
  return {
    schema: 'arcp/model-invocation/0.1',
    invocation_id: 'invocation:model-life:0',
    run_id: run().run_id,
    turn_index: 0,
    status: 'reserved',
    budget_envelope_id: 'envelope:model-life:0',
    input_hash: 'sha256:model-life-input',
    observed_at: now,
  };
}

function stores() {
  return [
    new InMemoryRunStateStore(),
    new D1RunStateStore(createFakeD1Database(`${migration1}\n${migration2}\n${migration3}`)),
  ];
}

describe('Phase 5.0A durable model invocation lifecycle', () => {
  it('supports idempotent create and CAS transitions without allowing stale/backward writes', async () => {
    for (const store of stores()) {
      await store.createRunIfAbsent(run());
      const initial = reserved();

      expect(await store.createModelInvocation(initial)).toEqual(initial);
      expect(await store.createModelInvocation(initial)).toEqual(initial);

      const calling = { ...initial, status: 'calling' as const };
      expect(await store.transitionModelInvocation(initial.invocation_id, 'reserved', calling)).toEqual(calling);

      await expect(store.transitionModelInvocation(initial.invocation_id, 'reserved', calling))
        .rejects.toMatchObject({ code: 'invalid_persisted_state' });

      const succeeded: Phase5ModelInvocationRecord = {
        ...calling,
        status: 'succeeded',
        output_hash: 'sha256:model-life-output',
        usage: { input_tokens: 10, output_tokens: 5, cost_micros: 20 },
      };
      expect(await store.transitionModelInvocation(initial.invocation_id, 'calling', succeeded)).toEqual(succeeded);
      expect(await store.getModelInvocation(initial.invocation_id)).toEqual(succeeded);

      await expect(store.transitionModelInvocation(
        initial.invocation_id,
        'succeeded',
        { ...succeeded, status: 'calling' },
      )).rejects.toMatchObject({ code: 'invalid_persisted_state' });
    }
  });
});
