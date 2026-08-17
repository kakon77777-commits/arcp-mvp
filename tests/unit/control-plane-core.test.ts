import { describe, expect, it } from 'vitest';
import type { ResidenceManifest, WakeRecord } from '@arcp/schema';
import {
  createControlPlaneHandler,
  type AuthorizationPort,
  type CoordinatorControlPort,
} from '@arcp/control-plane-core';

const manifest: ResidenceManifest = {
  schema: 'arcp/residence-manifest/0.1',
  agent_id: 'arcp:agent:evemisslab:00000000-0000-4000-8000-000000000301',
  residence_id: 'arcp:residence:00000000-0000-4000-8000-000000000302',
  manifest_version: 7,
  parents: ['arcp:manifest-version:6'],
  event_cursor: 'arcp:event:01PHASE1TEST',
  root_hash: 'sha256:phase1-test-root',
  policy_version: 3,
  lease_fencing_token: 12,
  status: 'active',
};

const wake: WakeRecord = {
  schema: 'arcp/wake/0.1',
  wake_id: 'arcp:wake:00000000-0000-4000-8000-000000000303',
  trigger_type: 'schedule',
  trigger_ref: 'ctcl:instant:test-phase1',
  required_authority: 'internal-low-risk',
  revalidate_on_wake: true,
  idempotency_key: 'wake:phase1:test:1',
};

function buildHarness() {
  const calls: WakeRecord[] = [];
  const coordinator: CoordinatorControlPort = {
    async getManifest(agentId) {
      return agentId === manifest.agent_id ? manifest : null;
    },
    async getStatus(agentId) {
      if (agentId !== manifest.agent_id) return null;
      return {
        agent_id: agentId,
        state: 'Dormant',
        manifest_version: manifest.manifest_version,
        root_hash: manifest.root_hash,
      };
    },
    async acceptWake(_agentId, submittedWake) {
      calls.push(submittedWake);
      return {
        status: 'accepted',
        policy_decision: 'allow-with-log',
        committed_version: null,
      };
    },
  };

  const authorization: AuthorizationPort = {
    async authorize(input) {
      return input.authorization === 'Bearer dev-test-token';
    },
  };

  return {
    calls,
    handler: createControlPlaneHandler({
      coordinator,
      authorization,
      nextRequestId: () => 'req_phase1_test',
    }),
  };
}

async function json(response: Response): Promise<any> {
  return response.json();
}

describe('Phase 1 control-plane HTTP core', () => {
  it('serves a credential-free health endpoint with an explicit non-commit state', async () => {
    const { handler } = buildHarness();
    const response = await handler.fetch(new Request('https://arcp.test/api/v1/health'));

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      request_id: 'req_phase1_test',
      result: { status: 'ok' },
      policy_decision: null,
      committed_version: null,
      commit_status: 'not_applicable',
    });
  });

  it('requires authorization for an Agent manifest read', async () => {
    const { handler } = buildHarness();
    const response = await handler.fetch(
      new Request(`https://arcp.test/api/v1/agents/${encodeURIComponent(manifest.agent_id)}/manifest`),
    );

    expect(response.status).toBe(401);
    expect((await json(response)).error.code).toBe('ARCP_AUTHENTICATION_REQUIRED');
  });

  it('returns the authoritative manifest through the coordinator port', async () => {
    const { handler } = buildHarness();
    const response = await handler.fetch(
      new Request(`https://arcp.test/api/v1/agents/${encodeURIComponent(manifest.agent_id)}/manifest`, {
        headers: { Authorization: 'Bearer dev-test-token' },
      }),
    );

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      request_id: 'req_phase1_test',
      result: manifest,
      policy_decision: null,
      committed_version: 7,
      commit_status: 'committed',
    });
  });

  it('rejects a wake mutation that omits the HTTP idempotency key', async () => {
    const { handler, calls } = buildHarness();
    const response = await handler.fetch(
      new Request(`https://arcp.test/api/v1/agents/${encodeURIComponent(manifest.agent_id)}/wakes`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer dev-test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(wake),
      }),
    );

    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe('ARCP_VALIDATION_IDEMPOTENCY_REQUIRED');
    expect(calls).toHaveLength(0);
  });

  it('accepts a valid wake but does not mislabel queue acceptance as a durable commit', async () => {
    const { handler, calls } = buildHarness();
    const response = await handler.fetch(
      new Request(`https://arcp.test/api/v1/agents/${encodeURIComponent(manifest.agent_id)}/wakes`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer dev-test-token',
          'Content-Type': 'application/json; charset=utf-8',
          'Idempotency-Key': wake.idempotency_key,
        },
        body: JSON.stringify(wake),
      }),
    );

    expect(response.status).toBe(202);
    expect(calls).toEqual([wake]);
    expect(await json(response)).toEqual({
      request_id: 'req_phase1_test',
      result: { wake_id: wake.wake_id, status: 'accepted' },
      policy_decision: 'allow-with-log',
      committed_version: null,
      commit_status: 'pending_coordinator_commit',
    });
  });

  it('rejects disagreement between the HTTP and WakeRecord idempotency keys', async () => {
    const { handler, calls } = buildHarness();
    const response = await handler.fetch(
      new Request(`https://arcp.test/api/v1/agents/${encodeURIComponent(manifest.agent_id)}/wakes`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer dev-test-token',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'wake:different:key',
        },
        body: JSON.stringify(wake),
      }),
    );

    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe('ARCP_VALIDATION_IDEMPOTENCY_MISMATCH');
    expect(calls).toHaveLength(0);
  });
});
