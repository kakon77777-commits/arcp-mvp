import { describe, expect, it } from 'vitest';
import type { ResidenceManifest, WakeRecord } from '@arcp/schema';
import {
  CoordinatorProtocolError,
  createCoordinatorClient,
  type CoordinatorFetchTransport,
} from '@arcp/control-plane-core';

const agentId = 'arcp:agent:evemisslab:00000000-0000-4000-8000-000000000401';
const manifest: ResidenceManifest = {
  schema: 'arcp/residence-manifest/0.1',
  agent_id: agentId,
  residence_id: 'arcp:residence:00000000-0000-4000-8000-000000000402',
  manifest_version: 3,
  parents: ['arcp:manifest-version:2'],
  event_cursor: 'arcp:event:transport-test',
  root_hash: 'sha256:transport-test-root',
  policy_version: 1,
  lease_fencing_token: 8,
  status: 'active',
};
const wake: WakeRecord = {
  schema: 'arcp/wake/0.1',
  wake_id: 'arcp:wake:00000000-0000-4000-8000-000000000403',
  trigger_type: 'schedule',
  trigger_ref: 'ctcl:instant:transport-test',
  required_authority: 'internal-low-risk',
  revalidate_on_wake: true,
  idempotency_key: 'wake:transport:test:1',
};

function envelope(result: unknown, committedVersion: number | null = null, policyDecision: string | null = null) {
  return new Response(
    JSON.stringify({
      request_id: 'coordinator-response',
      result,
      policy_decision: policyDecision,
      committed_version: committedVersion,
      commit_status: committedVersion === null ? 'pending_coordinator_commit' : 'committed',
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('coordinator transport client', () => {
  it('uses a stable encoded per-Agent path and propagates request IDs', async () => {
    const requests: Request[] = [];
    const transport: CoordinatorFetchTransport = {
      async fetch(request) {
        requests.push(request);
        return envelope(manifest, manifest.manifest_version);
      },
    };
    const client = createCoordinatorClient({
      transport,
      baseUrl: 'https://coordinator.internal',
      nextRequestId: () => 'req_transport_1',
    });

    await expect(client.getManifest(agentId)).resolves.toEqual(manifest);
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(new URL(request.url).pathname).toBe(
      `/internal/v1/agents/${encodeURIComponent(agentId)}/manifest`,
    );
    expect(request.headers.get('X-ARCP-Request-ID')).toBe('req_transport_1');
  });

  it('propagates wake idempotency through both header and body', async () => {
    const requests: Request[] = [];
    const transport: CoordinatorFetchTransport = {
      async fetch(request) {
        requests.push(request);
        // policy_decision and committed_version are envelope-level fields on
        // the wire, not nested inside result — result only carries the wake
        // status itself. See coordinator-client.ts's isWakeResult comment.
        return envelope({ status: 'accepted' }, null, 'allow-with-log');
      },
    };
    const client = createCoordinatorClient({
      transport,
      baseUrl: 'https://coordinator.internal',
      nextRequestId: () => 'req_transport_2',
    });

    await expect(client.acceptWake(agentId, wake)).resolves.toEqual({
      status: 'accepted',
      policy_decision: 'allow-with-log',
      committed_version: null,
    });

    const request = requests[0]!;
    expect(request.method).toBe('POST');
    expect(request.headers.get('Idempotency-Key')).toBe(wake.idempotency_key);
    expect(request.headers.get('X-ARCP-Request-ID')).toBe('req_transport_2');
    expect(await request.json()).toEqual(wake);
  });

  it('maps coordinator 404 reads to null rather than manufacturing state', async () => {
    const transport: CoordinatorFetchTransport = {
      async fetch() {
        return new Response(JSON.stringify({ error: { code: 'ARCP_AGENT_NOT_FOUND' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    };
    const client = createCoordinatorClient({ transport, nextRequestId: () => 'req_transport_3' });

    await expect(client.getManifest(agentId)).resolves.toBeNull();
    await expect(client.getStatus(agentId)).resolves.toBeNull();
  });

  it('fails closed on a malformed successful coordinator response', async () => {
    const transport: CoordinatorFetchTransport = {
      async fetch() {
        return new Response(JSON.stringify({ status: 'looks-successful-but-is-not-an-envelope' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    };
    const client = createCoordinatorClient({ transport, nextRequestId: () => 'req_transport_4' });

    await expect(client.getManifest(agentId)).rejects.toBeInstanceOf(CoordinatorProtocolError);
  });
});
