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
 */
export class CloudflareCoordinatorTransport {
  constructor(private readonly namespace: DurableObjectNamespaceLike) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/internal\/v1\/agents\/([^/]+)\/(manifest|status|wakes)$/);
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
