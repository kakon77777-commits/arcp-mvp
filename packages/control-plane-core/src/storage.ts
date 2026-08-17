import type { EventEnvelope, ResidenceManifest } from '@arcp/schema';

export type ManifestCasResult =
  | { status: 'committed'; manifest_version: number }
  | { status: 'conflict'; actual_version: number | null };

export type EventAppendResult = { status: 'appended' | 'duplicate' };

export type ObjectPutResult = {
  status: 'stored' | 'already_exists' | 'conflict';
  digest: string;
};

/**
 * Metadata persistence boundary intended for a D1-backed implementation.
 * Canonical-role and policy decisions are made above this port; the store only
 * persists already-governed metadata and provides explicit CAS semantics.
 */
export interface MetadataStorePort {
  getManifest(agentId: string): Promise<ResidenceManifest | null>;
  compareAndSwapManifest(
    agentId: string,
    expectedVersion: number | null,
    nextManifest: ResidenceManifest,
  ): Promise<ManifestCasResult>;
  appendEvent(event: EventEnvelope): Promise<EventAppendResult>;
  listEvents(agentId: string): Promise<EventEnvelope[]>;
}

/**
 * Content-addressed byte persistence boundary intended for an R2-backed
 * implementation. Callers supply the verified digest; this port does not
 * promote bytes to canonical state and does not make authorization decisions.
 */
export interface ObjectStorePort {
  put(digest: string, bytes: Uint8Array): Promise<ObjectPutResult>;
  get(digest: string): Promise<Uint8Array | null>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** Executable reference semantics for D1 adapter contract tests. */
export class InMemoryMetadataStore implements MetadataStorePort {
  private readonly manifests = new Map<string, ResidenceManifest>();
  private readonly eventsByAgent = new Map<string, EventEnvelope[]>();
  private readonly eventIds = new Set<string>();

  async getManifest(agentId: string): Promise<ResidenceManifest | null> {
    const manifest = this.manifests.get(agentId);
    return manifest ? clone(manifest) : null;
  }

  async compareAndSwapManifest(
    agentId: string,
    expectedVersion: number | null,
    nextManifest: ResidenceManifest,
  ): Promise<ManifestCasResult> {
    if (nextManifest.agent_id !== agentId) {
      throw new Error('manifest agent_id must match CAS key');
    }

    const current = this.manifests.get(agentId);
    const actualVersion = current?.manifest_version ?? null;
    if (actualVersion !== expectedVersion) {
      return { status: 'conflict', actual_version: actualVersion };
    }

    this.manifests.set(agentId, clone(nextManifest));
    return { status: 'committed', manifest_version: nextManifest.manifest_version };
  }

  async appendEvent(event: EventEnvelope): Promise<EventAppendResult> {
    if (this.eventIds.has(event.event_id)) {
      return { status: 'duplicate' };
    }

    this.eventIds.add(event.event_id);
    const existing = this.eventsByAgent.get(event.agent_id) ?? [];
    existing.push(clone(event));
    this.eventsByAgent.set(event.agent_id, existing);
    return { status: 'appended' };
  }

  async listEvents(agentId: string): Promise<EventEnvelope[]> {
    return (this.eventsByAgent.get(agentId) ?? []).map((event) => clone(event));
  }
}

/** Executable reference semantics for R2 adapter contract tests. */
export class InMemoryObjectStore implements ObjectStorePort {
  private readonly objects = new Map<string, Uint8Array>();

  async put(digest: string, bytes: Uint8Array): Promise<ObjectPutResult> {
    const current = this.objects.get(digest);
    if (current) {
      return {
        status: bytesEqual(current, bytes) ? 'already_exists' : 'conflict',
        digest,
      };
    }

    this.objects.set(digest, bytes.slice());
    return { status: 'stored', digest };
  }

  async get(digest: string): Promise<Uint8Array | null> {
    const bytes = this.objects.get(digest);
    return bytes ? bytes.slice() : null;
  }
}
