import { describe, expect, it } from 'vitest';
import { InMemoryMetadataStore } from '@arcp/control-plane-core';
import { AgentDurableObjectHandler } from '@arcp/adapter-cloudflare';
import type { CoordinatorControlPort } from '@arcp/control-plane-core';
import type { RunRecord } from '@arcp/schema';
import { DEFAULT_BOUNDED_RUN_BUDGET } from '@arcp/workflow-core';

const agentId = 'arcp:agent:phase4-do';
const now = { instant_id: 'local:unverified:phase4-do', unverified: true } as const;
const run: RunRecord = {
  schema: 'arcp/run/0.1', run_id: 'run:do:1', agent_id: agentId,
  wake_id: 'wake:do:1', wake_idempotency_key: 'wake:key:do:1', phase: 'waiting-approval',
  fencing_token: 3, budget_spec: { ...DEFAULT_BOUNDED_RUN_BUDGET }, turn_index: 1,
  checkpoint_sequence: 1, created_at: now, updated_at: now,
};

function phase4Coordinator(calls: string[]): CoordinatorControlPort {
  return {
    async getManifest() { return null; },
    async getStatus() { return null; },
    async acceptWake() { return { status: 'accepted', policy_decision: 'allow', committed_version: null }; },
    async getRun(_agentId, runId) { calls.push(`get:${runId}`); return run; },
    async advanceRun(_agentId, input) { calls.push(`advance:${input.run_id}`); return { run: { ...run, phase: 'completed' } }; },
    async submitApprovalGrant() { calls.push('grant'); return { accepted: true }; },
    async applyContainment(_agentId, record) { calls.push('contain'); return record; },
    async releaseContainment() { calls.push('release'); return { released: true }; },
  };
}

describe('Phase 4 Agent Durable Object host boundary', () => {
  it('rewrites and delegates nested per-Agent Phase 4 routes without changing their remainder', async () => {
    const calls: string[] = [];
    const handler = new AgentDurableObjectHandler(new InMemoryMetadataStore(), phase4Coordinator(calls));

    const get = await handler.fetch(new Request(
      `https://coordinator.internal/internal/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(run.run_id)}`,
    ));
    expect(get.status).toBe(200);
    expect((await get.json() as any).result.run_id).toBe(run.run_id);

    const advance = await handler.fetch(new Request(
      `https://coordinator.internal/internal/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(run.run_id)}/advance`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          run_id: run.run_id,
          wake: {
            schema: 'arcp/wake/0.1', wake_id: 'wake:resume', trigger_type: 'state', trigger_ref: 'approval:1',
            required_authority: 'approval-resume:1', revalidate_on_wake: true, idempotency_key: 'wake:key:resume',
          },
        }),
      },
    ));
    expect(advance.status).toBe(200);
    expect(calls).toEqual([`get:${run.run_id}`, `advance:${run.run_id}`]);
  });
});
