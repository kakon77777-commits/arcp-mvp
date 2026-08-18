import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DeterministicModelAdapter } from '@arcp/adapter-model';
import { evaluate } from '@arcp/policy-engine';
import type { PolicyInput, RunBudgetSpec, WakeRecord } from '@arcp/schema';
import {
  AgentDurableObjectHandler,
  D1MetadataStore,
  D1RunStateStore,
  Phase4AgentCoordinatorCore,
} from '@arcp/adapter-cloudflare';
import {
  BoundedRunOrchestrator,
  DEFAULT_BOUNDED_RUN_BUDGET,
  StaticActionAuthorityResolver,
  StaticWakeAuthorityResolver,
  deriveRunId,
  type ContextHydratorPort,
  type PolicyPort,
  type RunBudgetProviderPort,
} from '@arcp/workflow-core';
import { createFakeD1Database } from '../helpers/fake-d1-database.js';

const migration1 = readFileSync(fileURLToPath(new URL('../../migrations/d1/0001_init.sql', import.meta.url)), 'utf-8');
const migration2 = readFileSync(fileURLToPath(new URL('../../migrations/d1/0002_phase4_runs.sql', import.meta.url)), 'utf-8');
const agentId = 'arcp:agent:phase4-do-d1';
const now = { instant_id: 'local:unverified:phase4-do-d1', unverified: true } as const;
const wake: WakeRecord = {
  schema: 'arcp/wake/0.1', wake_id: 'wake:do-d1:1', trigger_type: 'schedule', trigger_ref: 'schedule:do-d1',
  required_authority: 'schedule:do-d1', revalidate_on_wake: true, idempotency_key: 'wake:key:do-d1:1',
};
const hydrator: ContextHydratorPort = {
  async hydrate() { return { baseManifestVersion: null, contextHash: 'sha256:do-d1-context', values: { source: 'd1' } }; },
};
const policy: PolicyPort = {
  evaluate(input: PolicyInput, options = {}) { return evaluate(input, { hasValidApproval: options.hasValidApproval }); },
};
const budgetProvider: RunBudgetProviderPort = {
  async resolveBudget(): Promise<RunBudgetSpec> { return { ...DEFAULT_BOUNDED_RUN_BUDGET }; },
};

describe('Phase 4 deterministic DO + D1 integration', () => {
  it('starts the deterministic run id, persists it in D1, and reads it back through the DO HTTP surface', async () => {
    const db = createFakeD1Database(`${migration1}\n${migration2}`);
    const metadata = new D1MetadataStore(db);
    const runStore = new D1RunStateStore(db);
    const model = new DeterministicModelAdapter([{
      actionIntents: [], stopReason: 'do-d1-complete', usage: { inputTokens: 3, outputTokens: 1 },
    }]);
    const engine = new BoundedRunOrchestrator({
      store: runStore,
      hydrator,
      model,
      wakeAuthority: new StaticWakeAuthorityResolver([{ requiredAuthority: 'schedule:do-d1', agentId }]),
      actionAuthority: new StaticActionAuthorityResolver({ grants: [] }),
      policy,
      budgetProvider,
      now: () => now,
    });
    const phase4 = new Phase4AgentCoordinatorCore(metadata, runStore, engine);
    const handler = new AgentDurableObjectHandler(metadata, phase4);
    const runId = deriveRunId(agentId, wake.idempotency_key);
    const base = `https://coordinator.internal/internal/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`;

    const advance = await handler.fetch(new Request(`${base}/advance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ run_id: runId, wake }),
    }));
    expect(advance.status).toBe(200);
    const advanced = await advance.json() as any;
    expect(advanced.result.run).toMatchObject({ run_id: runId, agent_id: agentId, phase: 'completed', stop_reason: 'do-d1-complete' });
    expect(model.invocations).toHaveLength(1);

    const read = await handler.fetch(new Request(base));
    expect(read.status).toBe(200);
    const readBody = await read.json() as any;
    expect(readBody.result).toEqual(advanced.result.run);
    expect((await runStore.getRun(runId))?.phase).toBe('completed');

    // Redelivery of the same first-wake path resolves to the same terminal run,
    // not a second logical run or second model call.
    const duplicate = await handler.fetch(new Request(`${base}/advance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ run_id: runId, wake }),
    }));
    expect(duplicate.status).toBe(200);
    expect(model.invocations).toHaveLength(1);
  });

  it('serializes two truly concurrent first-wake requests to the same DO instance into one logical run and one model call', async () => {
    const db = createFakeD1Database(`${migration1}\n${migration2}`);
    const metadata = new D1MetadataStore(db);
    const runStore = new D1RunStateStore(db);
    const concurrentWake: WakeRecord = {
      schema: 'arcp/wake/0.1', wake_id: 'wake:do-d1:concurrent', trigger_type: 'schedule', trigger_ref: 'schedule:do-d1',
      required_authority: 'schedule:do-d1', revalidate_on_wake: true, idempotency_key: 'wake:key:do-d1:concurrent',
    };
    const model = new DeterministicModelAdapter([
      { actionIntents: [], stopReason: 'do-d1-complete-a', usage: {} },
      { actionIntents: [], stopReason: 'do-d1-complete-b', usage: {} },
    ]);
    const engine = new BoundedRunOrchestrator({
      store: runStore,
      hydrator,
      model,
      wakeAuthority: new StaticWakeAuthorityResolver([{ requiredAuthority: 'schedule:do-d1', agentId }]),
      actionAuthority: new StaticActionAuthorityResolver({ grants: [] }),
      policy,
      budgetProvider,
      now: () => now,
    });
    const phase4 = new Phase4AgentCoordinatorCore(metadata, runStore, engine);
    const handler = new AgentDurableObjectHandler(metadata, phase4);
    const runId = deriveRunId(agentId, concurrentWake.idempotency_key);
    const base = `https://coordinator.internal/internal/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`;
    const advanceRequest = () => new Request(`${base}/advance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ run_id: runId, wake: concurrentWake }),
    });

    // Two requests for the SAME never-before-seen wake, started without
    // awaiting either first -- both would otherwise observe "no run exists
    // yet" before either durably creates one.
    const [first, second] = await Promise.all([
      handler.fetch(advanceRequest()),
      handler.fetch(advanceRequest()),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = await first.json() as any;
    const secondBody = await second.json() as any;
    expect(firstBody.result.run.run_id).toBe(runId);
    expect(secondBody.result.run.run_id).toBe(runId);
    expect(model.invocations).toHaveLength(1);
  });
});
