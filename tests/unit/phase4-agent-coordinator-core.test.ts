import { describe, expect, it } from 'vitest';
import { InMemoryMetadataStore } from '@arcp/control-plane-core';
import { Phase4AgentCoordinatorCore } from '@arcp/adapter-cloudflare';
import { DEFAULT_BOUNDED_RUN_BUDGET, InMemoryRunStateStore } from '@arcp/workflow-core';
import type { ApprovalGrant, ContainmentRecord, RunRecord, WakeRecord } from '@arcp/schema';

const agentId = 'arcp:agent:phase4-core';
const now = { instant_id: 'local:unverified:phase4-core', unverified: true } as const;
const wake: WakeRecord = {
  schema: 'arcp/wake/0.1', wake_id: 'wake:core:resume', trigger_type: 'state', trigger_ref: 'approval:core:1',
  required_authority: 'approval-resume:approval:core:1', revalidate_on_wake: true, idempotency_key: 'wake:key:core:resume',
};
function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    schema: 'arcp/run/0.1', run_id: 'run:core:1', agent_id: agentId,
    wake_id: 'wake:core:1', wake_idempotency_key: 'wake:key:core:1', phase: 'waiting-approval',
    fencing_token: 4, budget_spec: { ...DEFAULT_BOUNDED_RUN_BUDGET }, turn_index: 1,
    checkpoint_sequence: 1, created_at: now, updated_at: now, ...overrides,
  };
}

describe('Phase4AgentCoordinatorCore', () => {
  it('owns run lookup/advance fencing and Phase 4 governance mutations for one Agent', async () => {
    const store = new InMemoryRunStateStore();
    await store.createRunIfAbsent(run());
    const advances: any[] = [];
    const orchestrator = {
      async advance(input: any) {
        advances.push(input);
        const existing = (await store.getRun(input.runId))!;
        const next = { ...existing, fencing_token: input.fencingToken, phase: 'completed' as const };
        await store.updateRun(next, existing.fencing_token);
        return { run: next, stopReason: 'fixture' };
      },
    };
    const core = new Phase4AgentCoordinatorCore(new InMemoryMetadataStore(), store, orchestrator as any);

    await expect(core.getRun(agentId, 'run:core:1')).resolves.toMatchObject({ run_id: 'run:core:1' });
    await expect(core.advanceRun(agentId, { wake, run_id: 'run:core:1' })).resolves.toMatchObject({
      run: { phase: 'completed', fencing_token: 5 }, stop_reason: 'fixture',
    });
    expect(advances[0]).toMatchObject({ agentId, runId: 'run:core:1', fencingToken: 5 });

    const grant: ApprovalGrant = {
      schema: 'arcp/approval-grant/0.1', approval_grant_id: 'grant:core:1', approval_request_id: 'approval:core:1',
      approver_entity_ref: 'entity:neo', granted_scope: ['write'], granted_at: now, idempotency_key: 'grant:key:core:1',
    };
    await expect(core.submitApprovalGrant(agentId, grant.approval_request_id, grant)).resolves.toEqual({ accepted: true });

    const containment: ContainmentRecord = {
      schema: 'arcp/containment/0.1', containment_id: 'containment:core:1', agent_id: agentId,
      scope: ['external-action:write'], reason: 'fixture', authority_source: 'policy-authorized', entered_at: now,
      expires_at: now, review_required: true, exit_conditions: ['review'], status: 'active',
    };
    await expect(core.applyContainment(agentId, containment)).resolves.toEqual(containment);
    await expect(core.releaseContainment(agentId, containment.containment_id)).resolves.toEqual({ released: true });
    expect(await store.activeContainments(agentId)).toEqual([]);
  });

  it('refuses cross-Agent run access rather than leaking persisted run state', async () => {
    const store = new InMemoryRunStateStore();
    await store.createRunIfAbsent(run());
    const core = new Phase4AgentCoordinatorCore(new InMemoryMetadataStore(), store, { advance: async () => ({ run: run() }) } as any);
    await expect(core.getRun('arcp:agent:other', 'run:core:1')).resolves.toBeNull();
  });
});
