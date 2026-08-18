import { describe, expect, it } from 'vitest';
import { createControlPlaneHandler } from '@arcp/control-plane-core';
import type {
  ApprovalGrant,
  ContainmentRecord,
  RunRecord,
  WakeRecord,
} from '@arcp/schema';
import { DEFAULT_BOUNDED_RUN_BUDGET } from '@arcp/workflow-core';

const agentId = 'arcp:agent:phase4-http';
const now = { instant_id: 'local:unverified:phase4-http', unverified: true } as const;
const run: RunRecord = {
  schema: 'arcp/run/0.1', run_id: 'run:http:1', agent_id: agentId,
  wake_id: 'wake:http:1', wake_idempotency_key: 'wake:key:http:1', phase: 'waiting-approval',
  fencing_token: 2, budget_spec: { ...DEFAULT_BOUNDED_RUN_BUDGET }, turn_index: 1,
  checkpoint_sequence: 1, created_at: now, updated_at: now,
};
const wake: WakeRecord = {
  schema: 'arcp/wake/0.1', wake_id: 'wake:http:resume', trigger_type: 'state', trigger_ref: 'approval:http:1',
  required_authority: 'approval-resume:approval:http:1', revalidate_on_wake: true,
  idempotency_key: 'wake:key:http:resume',
};

function handler() {
  const calls: string[] = [];
  const coordinator = {
    async getManifest() { return null; },
    async getStatus() { return null; },
    async acceptWake() { return { status: 'accepted' as const, policy_decision: 'allow' as const, committed_version: null }; },
    async getRun(_agentId: string, runId: string) { calls.push(`getRun:${runId}`); return run; },
    async advanceRun(_agentId: string, input: { wake: WakeRecord; run_id?: string }) {
      calls.push(`advance:${input.run_id ?? 'new'}`);
      return { run: { ...run, phase: 'completed' as const }, stop_reason: 'fixture' };
    },
    async submitApprovalGrant(_agentId: string, requestId: string, grant: ApprovalGrant) {
      calls.push(`grant:${requestId}:${grant.approver_entity_ref}`);
      return { accepted: true as const };
    },
    async applyContainment(_agentId: string, record: ContainmentRecord) {
      calls.push(`contain:${record.containment_id}`);
      return record;
    },
    async releaseContainment(_agentId: string, containmentId: string) {
      calls.push(`release:${containmentId}`);
      return { released: true as const };
    },
  };
  const api = createControlPlaneHandler({
    coordinator,
    authorization: { authorize: () => true },
    nextRequestId: () => 'req:phase4',
  });
  return { api, calls };
}

describe('Phase 4 control-plane routes', () => {
  it('reads a persisted run through the normal success envelope', async () => {
    const { api, calls } = handler();
    const response = await api.fetch(new Request(`https://arcp.test/api/v1/agents/${encodeURIComponent(agentId)}/runs/run%3Ahttp%3A1`));
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.result.run_id).toBe('run:http:1');
    expect(body.commit_status).toBe('not_applicable');
    expect(calls).toEqual(['getRun:run:http:1']);
  });

  it('advances a bounded run without holding the HTTP request for later approval', async () => {
    const { api, calls } = handler();
    const response = await api.fetch(new Request(
      `https://arcp.test/api/v1/agents/${encodeURIComponent(agentId)}/runs/run%3Ahttp%3A1/advance`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wake, run_id: 'run:http:1' }) },
    ));
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.result.run.phase).toBe('completed');
    expect(calls).toEqual(['advance:run:http:1']);
  });

  it('submits an exact approval grant and applies/releases containment', async () => {
    const { api, calls } = handler();
    const grant: ApprovalGrant = {
      schema: 'arcp/approval-grant/0.1', approval_grant_id: 'grant:http:1', approval_request_id: 'approval:http:1',
      approver_entity_ref: 'entity:neo', granted_scope: ['write'], granted_at: now, idempotency_key: 'grant:key:http:1',
    };
    const grantResponse = await api.fetch(new Request(
      `https://arcp.test/api/v1/agents/${encodeURIComponent(agentId)}/approvals/approval%3Ahttp%3A1/grants`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(grant) },
    ));
    expect(grantResponse.status).toBe(202);

    const containment: ContainmentRecord = {
      schema: 'arcp/containment/0.1', containment_id: 'containment:http:1', agent_id: agentId,
      scope: ['external-action:write'], reason: 'fixture', authority_source: 'policy-authorized',
      entered_at: now, expires_at: now, review_required: true, exit_conditions: ['review'], status: 'active',
    };
    const apply = await api.fetch(new Request(
      `https://arcp.test/api/v1/agents/${encodeURIComponent(agentId)}/containments`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(containment) },
    ));
    expect(apply.status).toBe(202);
    const release = await api.fetch(new Request(
      `https://arcp.test/api/v1/agents/${encodeURIComponent(agentId)}/containments/containment%3Ahttp%3A1/release`,
      { method: 'POST' },
    ));
    expect(release.status).toBe(200);
    expect(calls).toEqual([
      'grant:approval:http:1:entity:neo',
      'contain:containment:http:1',
      'release:containment:http:1',
    ]);
  });
});
