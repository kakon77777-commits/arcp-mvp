import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { D1RunStateStore } from '@arcp/adapter-cloudflare';
import type { RunRecord } from '@arcp/schema';
import {
  DEFAULT_BOUNDED_RUN_BUDGET,
  InMemoryRunStateStore,
} from '@arcp/workflow-core';
import { createFakeD1Database } from '../helpers/fake-d1-database.js';

const migration1 = readFileSync(fileURLToPath(new URL('../../migrations/d1/0001_init.sql', import.meta.url)), 'utf-8');
const migration2 = readFileSync(fileURLToPath(new URL('../../migrations/d1/0002_phase4_runs.sql', import.meta.url)), 'utf-8');
const now = { instant_id: 'local:unverified:budget-view-parity', unverified: true } as const;

function makeRun(): RunRecord {
  const {
    max_model_input_tokens: _input,
    max_model_output_tokens: _output,
    max_model_cost_micros: _cost,
    ...withoutOptionalModelLimits
  } = DEFAULT_BOUNDED_RUN_BUDGET;

  return {
    schema: 'arcp/run/0.1',
    run_id: 'run:budget-view:1',
    agent_id: 'arcp:agent:budget-view',
    wake_id: 'wake:budget-view:1',
    wake_idempotency_key: 'wake:key:budget-view:1',
    phase: 'accepted',
    fencing_token: 1,
    budget_spec: { ...withoutOptionalModelLimits },
    turn_index: 0,
    checkpoint_sequence: 0,
    created_at: now,
    updated_at: now,
  };
}

describe('Phase 5.0A durable budget-view parity', () => {
  it('returns the same complete ten-dimension view from in-memory and D1 stores', async () => {
    const memory = new InMemoryRunStateStore();
    const d1 = new D1RunStateStore(createFakeD1Database(`${migration1}\n${migration2}`));
    const run = makeRun();

    await memory.createRunIfAbsent(run);
    await d1.createRunIfAbsent(run);

    const memoryView = await memory.getBudgetView(run.run_id);
    const d1View = await d1.getBudgetView(run.run_id);

    expect(Object.keys(memoryView).sort()).toHaveLength(10);
    expect(Object.keys(d1View).sort()).toHaveLength(10);
    expect(d1View).toEqual(memoryView);
  });

  it('resolves omitted optional model budgets to zero rather than unlimited', async () => {
    const memory = new InMemoryRunStateStore();
    const d1 = new D1RunStateStore(createFakeD1Database(`${migration1}\n${migration2}`));
    const run = makeRun();

    await memory.createRunIfAbsent(run);
    await d1.createRunIfAbsent(run);

    for (const view of [
      await memory.getBudgetView(run.run_id),
      await d1.getBudgetView(run.run_id),
    ]) {
      expect(view.model_input_tokens.limit).toBe(0);
      expect(view.model_output_tokens.limit).toBe(0);
      expect(view.model_cost_micros.limit).toBe(0);
    }
  });
});
