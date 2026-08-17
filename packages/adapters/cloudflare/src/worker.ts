import { createControlPlaneHandler, createCoordinatorClient } from '@arcp/control-plane-core';
import type { AuthorizationPort, ControlPlaneHandler } from '@arcp/control-plane-core';
import { CloudflareCoordinatorTransport } from './coordinator-transport.js';
import type { DurableObjectNamespaceLike } from './coordinator-transport.js';
import { AgentDurableObjectHandler } from './agent-durable-object.js';
import { D1MetadataStore } from './d1-metadata-store.js';
import type { D1DatabaseLike } from './d1-types.js';

/**
 * Phase 1 placeholder: verifies only that an Authorization header is
 * present, not its validity. Real credential verification is a separate
 * decision (not yet an ADR item in the Phase 1 plan) and must land before
 * this goes beyond local/dev testing — do not treat this as an auth model.
 */
export const presenceOnlyAuthorization: AuthorizationPort = {
  authorize: ({ authorization }) => authorization !== null && authorization.trim().length > 0,
};

let publicRequestCounter = 0;
function nextPublicRequestId(): string {
  publicRequestCounter += 1;
  return `pub-req-${publicRequestCounter}`;
}

export interface ArcpWorkerEnv {
  AGENTS: DurableObjectNamespaceLike;
}

/**
 * The public Worker entrypoint (`/api/v1/...`). Talks to per-Agent Durable
 * Objects only through CloudflareCoordinatorTransport's internal route
 * contract — it never touches D1/R2 directly; that happens inside the DO.
 */
export function createArcpWorkerHandler(env: ArcpWorkerEnv): ControlPlaneHandler {
  const transport = new CloudflareCoordinatorTransport(env.AGENTS);
  const coordinator = createCoordinatorClient({ transport, nextRequestId: nextPublicRequestId });
  return createControlPlaneHandler({
    coordinator,
    authorization: presenceOnlyAuthorization,
    nextRequestId: nextPublicRequestId,
  });
}

export default {
  async fetch(request: Request, env: ArcpWorkerEnv): Promise<Response> {
    return createArcpWorkerHandler(env).fetch(request);
  },
};

export interface ArcpDurableObjectEnv {
  DB: D1DatabaseLike;
}

/**
 * The per-Agent Durable Object class Cloudflare instantiates directly (one
 * named instance per canonical Agent ID, via `AGENTS.getByName(agentId)`).
 * The first constructor parameter is DurableObjectState in the real runtime;
 * Phase 1 doesn't touch the DO's own transactional storage (D1 is the
 * metadata store), so it's accepted but intentionally left untyped/unused
 * here rather than pulling in @cloudflare/workers-types for one unused param.
 */
export class ArcpAgentDurableObject {
  private readonly handler: AgentDurableObjectHandler;

  constructor(_state: unknown, env: ArcpDurableObjectEnv) {
    this.handler = new AgentDurableObjectHandler(new D1MetadataStore(env.DB));
  }

  fetch(request: Request): Promise<Response> {
    return this.handler.fetch(request);
  }
}
