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

  // Serializes concurrent /runs/:run/advance calls to this one Durable
  // Object instance. A DO's JS isolate is single-threaded but still
  // cooperatively multitasks across await points -- nothing about `fetch`
  // being a method on a single-instance class makes two near-simultaneous
  // invocations run one after the other. Without this queue, two racing
  // first-wake requests for the same (agent_id, wake.idempotency_key) can
  // both observe "no run exists yet" before either durably creates one, so
  // both proceed to invoke the model -- exactly the double-invocation the
  // deterministic (agent_id, wake.idempotency_key) -> run_id binding is
  // meant to prevent.
  //
  // This queue is scoped to advance requests only, NOT every fetch. The
  // race above is specific to advance's "check if a run exists, create it
  // if not" pattern -- containment/approval writes and reads have no
  // equivalent race, and queuing them behind an in-flight advance would
  // make an emergency containment wait on whatever slow model/tool call
  // that advance is awaiting, undermining the reason emergency containment
  // exists. "Single-writer for run mutation" and "single-request-at-a-time
  // for everything" are not the same guarantee; only the former is needed.
  private advanceQueue: Promise<unknown> = Promise.resolve();

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

    const rewritten = new Request(rewrittenUrl, init);
    const isAdvance = request.method === 'POST' &&
      /^\/api\/v1\/agents\/[^/]+\/runs\/[^/]+\/advance$/.test(rewrittenUrl.pathname);
    if (!isAdvance) {
      return this.inner.fetch(rewritten);
    }

    const handled = this.advanceQueue.then(
      () => this.inner.fetch(rewritten),
      () => this.inner.fetch(rewritten),
    );
    // Keep the queue alive even if this request's handling rejects, so one
    // failure never permanently wedges every advance request queued behind it.
    this.advanceQueue = handled.catch(() => undefined);
    return handled;
  }
}
