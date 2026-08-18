import { describe, expect, it } from 'vitest';
import { InMemoryMetadataStore } from '@arcp/control-plane-core';
import { Phase4AgentCoordinatorCore } from '@arcp/adapter-cloudflare';
import {
  DEFAULT_BOUNDED_RUN_BUDGET,
  InMemoryRunStateStore,
  deriveRunId,
} from '@arcp/workflow-core';
import type { ApprovalGrant, ApprovalRequest, ContainmentRecord, RunRecord, WakeRecord } from '@arcp/schema';

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
  it('starts a first run only when the requested run id is the deterministic wake binding', async () => {
    const store = new InMemoryRunStateStore();
    const firstWake: WakeRecord = {
      schema: 'arcp/wake/0.1', wake_id: 'wake:first:1', trigger_type: 'schedule', trigger_ref: 'schedule:daily',
      required_authority: 'schedule:daily', revalidate_on_wake: true, idempotency_key: 'wake:key:first:1',
    };
    const expectedRunId = deriveRunId(agentId, firstWake.idempotency_key);
    const advances: any[] = [];
    const core = new Phase4AgentCoordinatorCore(new InMemoryMetadataStore(), store, {
      async advance(input: any) {
        advances.push(input);
        const created = await store.createRunIfAbsent({
          schema: 'arcp/run/0.1', run_id: expectedRunId, agent_id: agentId, wake_id: firstWake.wake_id,
          wake_idempotency_key: firstWake.idempotency_key, phase: 'completed', fencing_token: input.fencingToken,
          budget_spec: { ...DEFAULT_BOUNDED_RUN_BUDGET }, turn_index: 1, checkpoint_sequence: 0,
          created_at: now, updated_at: now, stop_reason: 'fixture',
        });
        return { run: created, stopReason: 'fixture' };
      },
    } as any);

    await expect(core.advanceRun(agentId, { wake: firstWake, run_id: expectedRunId })).resolves.toMatchObject({
      run: { run_id: expectedRunId, phase: 'completed' },
    });
    expect(advances[0]).toMatchObject({ agentId, fencingToken: 1 });
    expect(advances[0].runId).toBeUndefined();

    await expect(core.advanceRun(agentId, { wake: firstWake, run_id: 'arcp:run:forged' }))
      .rejects.toMatchObject({ code: 'invalid_wake' });
  });

  it('owns run lookup/advance fencing and Phase 4 governance mutations for one Agent', async () => {
    const store = new InMemoryRunStateStore();
    await store.createRunIfAbsent(run());
    const approval: ApprovalRequest = {
      schema: 'arcp/approval-request/0.1', approval_request_id: 'approval:core:1', run_id: 'run:core:1',
      action_id: 'action:core:1', action_hash: 'sha256:action', authority_resolution_hash: 'sha256:authority',
      policy_version: 1, binding_hash: 'sha256:binding', required_parties: ['entity:neo'], requested_scope: ['write'],
      created_at: now, expires_at: now, status: 'pending',
    };
    await store.createApprovalRequest(approval);

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
      schema: 'arcp/approval-grant/0.1', approval_grant_id: 'grant:core:1', approval_request_id: approval.approval_request_id,
      approver_entity_ref: 'entity:neo', granted_scope: ['write'], granted_at: now, idempotency_key: 'grant:key:core:1',
    };
    await expect(core.submitApprovalGrant(agentId, grant.approval_request_id, grant)).resolves.toEqual({ accepted: true });

    const containment: ContainmentRecord = {
      schema: 'arcp/containment/0.1', containment_id: 'containment:core:1', agent_id: agentId,
      scope: ['external-action:write'], reason: 'fixture', authority_source: 'policy-authorized', entered_at: now,
      expires_at: now, review_required: true, exit_conditions: ['review'], status: 'active',
    };
    await expect(core.applyContainment(agentId, containment)).resolves.toEqual({ ...containment, renewal_count: 0 });
    await expect(core.releaseContainment(agentId, containment.containment_id)).resolves.toEqual({ released: true });
    expect(await store.activeContainments(agentId)).toEqual([]);
  });

  it('refuses cross-Agent run access rather than leaking persisted run state', async () => {
    const store = new InMemoryRunStateStore();
    await store.createRunIfAbsent(run());
    const core = new Phase4AgentCoordinatorCore(new InMemoryMetadataStore(), store, { advance: async () => ({ run: run() }) } as any);
    await expect(core.getRun('arcp:agent:other', 'run:core:1')).resolves.toBeNull();
  });

  it('derives renewal_count server-side on each actual renewal instead of trusting the caller-supplied value', async () => {
    const store = new InMemoryRunStateStore();
    const core = new Phase4AgentCoordinatorCore(new InMemoryMetadataStore(), store, { advance: async () => ({ run: run() }) } as any);
    const containment: ContainmentRecord = {
      schema: 'arcp/containment/0.1', containment_id: 'containment:renewal:1', agent_id: agentId,
      scope: ['external-action:write'], reason: 'fixture', authority_source: 'policy-authorized', entered_at: now,
      expires_at: now, review_required: true, exit_conditions: ['review'], status: 'active',
    };

    const applied = await core.applyContainment(agentId, containment);
    expect(applied.renewal_count).toBe(0);

    // A renewal caller supplying a spoofed renewal_count must not be trusted --
    // the server always derives it from the existing record.
    const firstRenewal = await core.applyContainment(agentId, { ...containment, status: 'renewed', renewal_count: 999 });
    expect(firstRenewal.renewal_count).toBe(1);

    const secondRenewal = await core.applyContainment(agentId, { ...containment, status: 'renewed' });
    expect(secondRenewal.renewal_count).toBe(2);

    // Re-applying without a status of 'renewed' does not itself increment the count.
    const reapplied = await core.applyContainment(agentId, { ...containment, status: 'active' });
    expect(reapplied.renewal_count).toBe(2);
  });
});
