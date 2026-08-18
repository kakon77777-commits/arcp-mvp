export interface DurableObjectStubLike {
  fetch(request: Request): Promise<Response>;
}

export interface DurableObjectNamespaceLike {
  getByName(name: string): DurableObjectStubLike;
}

/**
 * Worker-side transport from the platform-neutral coordinator client to a
 * Cloudflare Durable Object namespace. Each canonical Agent ID maps to exactly
 * one named Durable Object, preserving the single-writer coordinator boundary.
 *
 * Phase 4 intentionally routes the whole `/internal/v1/agents/:agent/...`
 * namespace rather than enumerating every leaf here. The Durable Object's
 * control-plane handler remains responsible for deciding which nested routes
 * actually exist, so Phase 5 can add capabilities without changing the Agent
 * -> Durable Object routing invariant.
 */
export class CloudflareCoordinatorTransport {
  constructor(private readonly namespace: DurableObjectNamespaceLike) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/internal\/v1\/agents\/([^/]+)(?:\/|$)/);
    if (!match) {
      throw new Error('invalid ARCP coordinator route');
    }

    let agentId: string;
    try {
      agentId = decodeURIComponent(match[1]!);
    } catch {
      throw new Error('invalid ARCP coordinator route');
    }

    if (!agentId.startsWith('arcp:agent:')) {
      throw new Error('invalid ARCP coordinator route');
    }

    return this.namespace.getByName(agentId).fetch(request);
  }
}
