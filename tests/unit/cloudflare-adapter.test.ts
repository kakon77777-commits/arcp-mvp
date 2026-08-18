import { describe, expect, it } from 'vitest';
import {
  CloudflareCoordinatorTransport,
  type DurableObjectNamespaceLike,
} from '@arcp/adapter-cloudflare';

const agentId = 'arcp:agent:evemisslab:00000000-0000-4000-8000-000000000601';

describe('Cloudflare coordinator transport', () => {
  it('routes an internal coordinator request to the Durable Object named by Agent ID', async () => {
    const names: string[] = [];
    const forwarded: Request[] = [];
    const namespace: DurableObjectNamespaceLike = {
      getByName(name) {
        names.push(name);
        return {
          async fetch(request) {
            forwarded.push(request);
            return new Response('ok', { status: 200 });
          },
        };
      },
    };
    const transport = new CloudflareCoordinatorTransport(namespace);
    const request = new Request(
      `https://coordinator.internal/internal/v1/agents/${encodeURIComponent(agentId)}/manifest`,
      { headers: { 'X-ARCP-Request-ID': 'req_cf_1' } },
    );

    const response = await transport.fetch(request);

    expect(response.status).toBe(200);
    expect(names).toEqual([agentId]);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]!.url).toBe(request.url);
    expect(forwarded[0]!.headers.get('X-ARCP-Request-ID')).toBe('req_cf_1');
  });

  it('routes Phase 4 nested run/approval/containment paths through the same Agent Durable Object', async () => {
    const names: string[] = [];
    const paths: string[] = [];
    const namespace: DurableObjectNamespaceLike = {
      getByName(name) {
        names.push(name);
        return {
          async fetch(request) {
            paths.push(new URL(request.url).pathname);
            return new Response('ok', { status: 200 });
          },
        };
      },
    };
    const transport = new CloudflareCoordinatorTransport(namespace);
    const encodedAgent = encodeURIComponent(agentId);
    const routes = [
      `/internal/v1/agents/${encodedAgent}/runs/run%3A1`,
      `/internal/v1/agents/${encodedAgent}/runs/run%3A1/advance`,
      `/internal/v1/agents/${encodedAgent}/approvals/approval%3A1/grants`,
      `/internal/v1/agents/${encodedAgent}/containments`,
      `/internal/v1/agents/${encodedAgent}/containments/containment%3A1/release`,
    ];

    for (const path of routes) {
      await expect(transport.fetch(new Request(`https://coordinator.internal${path}`))).resolves.toHaveProperty('status', 200);
    }
    expect(names).toEqual(routes.map(() => agentId));
    expect(paths).toEqual(routes);
  });

  it('fails closed when a request does not contain a canonical per-Agent coordinator route', async () => {
    let called = false;
    const namespace: DurableObjectNamespaceLike = {
      getByName() {
        called = true;
        throw new Error('must not route malformed paths');
      },
    };
    const transport = new CloudflareCoordinatorTransport(namespace);

    await expect(
      transport.fetch(new Request('https://coordinator.internal/internal/v1/status')),
    ).rejects.toThrow('invalid ARCP coordinator route');
    expect(called).toBe(false);
  });

  it('rejects invalid percent-encoding rather than creating a second namespace name', async () => {
    let called = false;
    const namespace: DurableObjectNamespaceLike = {
      getByName() {
        called = true;
        throw new Error('must not be called');
      },
    };
    const transport = new CloudflareCoordinatorTransport(namespace);

    await expect(
      transport.fetch(new Request('https://coordinator.internal/internal/v1/agents/%E0%A4%A/manifest')),
    ).rejects.toThrow('invalid ARCP coordinator route');
    expect(called).toBe(false);
  });
});
