import { createControlPlaneHandler } from '@arcp/control-plane-core';
import type {
  AuthorizationPort,
  CoordinatorControlPort,
  MetadataStorePort,
} from '@arcp/control-plane-core';
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

function bindPhase4Capabilities(
  base: AgentDurableObjectCore,
  phase4?: CoordinatorControlPort,
): CoordinatorControlPort {
  return {
    getManifest: base.getManifest.bind(base),
    getStatus: base.getStatus.bind(base),
    acceptWake: base.acceptWake.bind(base),
    ...(phase4?.getRun ? { getRun: phase4.getRun.bind(phase4) } : {}),
    ...(phase4?.advanceRun ? { advanceRun: phase4.advanceRun.bind(phase4) } : {}),
    ...(phase4?.submitApprovalGrant
      ? { submitApprovalGrant: phase4.submitApprovalGrant.bind(phase4) }
      : {}),
    ...(phase4?.applyContainment
      ? { applyContainment: phase4.applyContainment.bind(phase4) }
      : {}),
    ...(phase4?.releaseContainment
      ? { releaseContainment: phase4.releaseContainment.bind(phase4) }
      : {}),
  };
}

/**
 * The per-Agent Durable Object request handler. The public Worker already
 * performs authentication; this internal handler reuses the same validated
 * HTTP/envelope semantics with an always-authorized internal boundary.
 *
 * Phase 4 routes are deliberately injected as coordinator capabilities. This
 * keeps the DO's single-writer routing independent from model/provider choice:
 * deterministic test runtimes and later Gate C live runtimes can supply the
 * same capability surface without changing public or internal URLs.
 */
export class AgentDurableObjectHandler {
  private readonly inner: ReturnType<typeof createControlPlaneHandler>;

  constructor(metadataStore: MetadataStorePort, phase4Coordinator?: CoordinatorControlPort) {
    const base = new AgentDurableObjectCore(metadataStore);
    this.inner = createControlPlaneHandler({
      coordinator: bindPhase4Capabilities(base, phase4Coordinator),
      authorization: alwaysAuthorized,
      nextRequestId,
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!/^\/internal\/v1\/agents\/[^/]+(?:\/|$)/.test(url.pathname)) {
      return notFound();
    }

    const rewrittenUrl = new URL(request.url);
    rewrittenUrl.pathname = url.pathname.replace(/^\/internal\/v1\//, '/api/v1/');

    const init: RequestInit = { method: request.method, headers: request.headers };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = await request.arrayBuffer();
    }

    return this.inner.fetch(new Request(rewrittenUrl, init));
  }
}
