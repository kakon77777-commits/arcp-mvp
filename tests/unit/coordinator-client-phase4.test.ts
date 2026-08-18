import { describe, expect, it } from 'vitest';
import { createCoordinatorClient, type CoordinatorFetchTransport } from '@arcp/control-plane-core';
import type { ApprovalGrant, ContainmentRecord, RunRecord, WakeRecord } from '@arcp/schema';
import { DEFAULT_BOUNDED_RUN_BUDGET } from '@arcp/workflow-core';

const agentId = 'arcp:agent:phase4-client';
const now = { instant_id: 'local:unverified:phase4-client', unverified: true } as const;
const run: RunRecord = {
  schema: 'arcp/run/0.1', run_id: 'run:client:1', agent_id: agentId,
  wake_id: 'wake:client:1', wake_idempotency_key: 'wake:key:client:1', phase: 'waiting-approval',
  fencing_token: 7, budget_spec: { ...DEFAULT_BOUNDED_RUN_BUDGET }, turn_index: 1,
  checkpoint_sequence: 1, created_at: now, updated_at: now,
};
const wake: WakeRecord = {
  schema: 'arcp/wake/0.1', wake_id: 'wake:client:resume', trigger_type: 'state', trigger_ref: 'approval:client:1',
  required_authority: 'approval-resume:approval:client:1', revalidate_on_wake: true,
  idempotency_key: 'wake:key:client:resume',
};

function envelope(result: unknown, status = 200) {
  return new Response(JSON.stringify({
    request_id: 'req:server', result, policy_decision: null,
    committed_version: null, commit_status: 'not_applicable',
  }), { status, headers: { 'content-type': 'application/json' } });
}

describe('Phase 4 coordinator client', () => {
  it('reads and advances the exact persisted run path', async () => {
    const requests: Request[] = [];
    const transport: CoordinatorFetchTransport = {
      async fetch(request) {
        requests.push(request);
        if (request.method === 'GET') return envelope(run);
        return envelope({ run: { ...run, phase: 'completed' }, stop_reason: 'fixture' });
      },
    };
    const client = createCoordinatorClient({ transport, nextRequestId: () => 'req:client' });

    await expect(client.getRun!(agentId, run.run_id)).resolves.toEqual(run);
    await expect(client.advanceRun!(agentId, { wake, run_id: run.run_id, fencing_token: 8 }))
      .resolves.toMatchObject({ run: { phase: 'completed' }, stop_reason: 'fixture' });

    expect(new URL(requests[0]!.url).pathname).toBe(
      `/internal/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(run.run_id)}`,
    );
    expect(new URL(requests[1]!.url).pathname).toBe(
      `/internal/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(run.run_id)}/advance`,
    );
    expect(await requests[1]!.json()).toEqual({ wake, run_id: run.run_id, fencing_token: 8 });
  });

  it('forwards approval and containment mutations without widening their payloads', async () => {
    const requests: Request[] = [];
    const transport: CoordinatorFetchTransport = {
      async fetch(request) {
        requests.push(request);
        if (new URL(request.url).pathname.endsWith('/grants')) return envelope({ accepted: true }, 202);
        if (new URL(request.url).pathname.endsWith('/release')) return envelope({ released: true });
        return envelope(containment, 202);
      },
    };
    const client = createCoordinatorClient({ transport, nextRequestId: () => 'req:client' });
    const grant: ApprovalGrant = {
      schema: 'arcp/approval-grant/0.1', approval_grant_id: 'grant:client:1', approval_request_id: 'approval:client:1',
      approver_entity_ref: 'entity:neo', granted_scope: ['write'], granted_at: now, idempotency_key: 'grant:key:client:1',
    };
    const containment: ContainmentRecord = {
      schema: 'arcp/containment/0.1', containment_id: 'containment:client:1', agent_id: agentId,
      scope: ['external-action:write'], reason: 'fixture', authority_source: 'policy-authorized',
      entered_at: now, expires_at: now, review_required: true, exit_conditions: ['review'], status: 'active',
    };

    await expect(client.submitApprovalGrant!(agentId, grant.approval_request_id, grant)).resolves.toEqual({ accepted: true });
    await expect(client.applyContainment!(agentId, containment)).resolves.toEqual(containment);
    await expect(client.releaseContainment!(agentId, containment.containment_id)).resolves.toEqual({ released: true });

    expect(await requests[0]!.json()).toEqual(grant);
    expect(await requests[1]!.json()).toEqual(containment);
    expect(requests[2]!.method).toBe('POST');
  });
});
