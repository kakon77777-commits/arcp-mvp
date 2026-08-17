import { createControlPlaneHandler } from '@arcp/control-plane-core';
import type { AuthorizationPort, MetadataStorePort } from '@arcp/control-plane-core';
import { AgentDurableObjectCore } from './agent-durable-object-core.js';

const alwaysAuthorized: AuthorizationPort = { authorize: () => true };

let requestCounter = 0;
function nextRequestId(): string {
  requestCounter += 1;
  return `do-req-${requestCounter}`;
}

function notFound(): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: 'ARCP_ROUTE_NOT_FOUND',
        message: 'No ARCP internal route matches this request.',
      },
    }),
    { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  );
}

/**
 * The per-Agent Durable Object's request handler (Task 5B). Reachable only
 * via CloudflareCoordinatorTransport inside the same Worker — never exposed
 * directly to the internet — so it reuses control-plane-core's envelope
 * format by rewriting `/internal/v1/...` to `/api/v1/...` and delegating,
 * but skips the public gateway's Authorization check: that check already ran
 * once, at the public /api/v1 boundary, before the request ever reached this
 * Durable Object.
 */
export class AgentDurableObjectHandler {
  private readonly inner: ReturnType<typeof createControlPlaneHandler>;

  constructor(metadataStore: MetadataStorePort) {
    this.inner = createControlPlaneHandler({
      coordinator: new AgentDurableObjectCore(metadataStore),
      authorization: alwaysAuthorized,
      nextRequestId,
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/internal\/v1\/agents\/([^/]+)\/(manifest|status|wakes)$/);
    if (!match) {
      return notFound();
    }

    const rewrittenUrl = new URL(request.url);
    rewrittenUrl.pathname = `/api/v1/agents/${match[1]}/${match[2]}`;

    const init: RequestInit = { method: request.method, headers: request.headers };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = await request.arrayBuffer();
    }

    return this.inner.fetch(new Request(rewrittenUrl, init));
  }
}
