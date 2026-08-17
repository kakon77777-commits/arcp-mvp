import { describe, expect, it } from 'vitest';
import type { EventEnvelope, ResidenceManifest } from '@arcp/schema';
import {
  InMemoryMetadataStore,
  InMemoryObjectStore,
} from '@arcp/control-plane-core';

const agentId = 'arcp:agent:evemisslab:00000000-0000-4000-8000-000000000501';

function manifest(version: number): ResidenceManifest {
  return {
    schema: 'arcp/residence-manifest/0.1',
    agent_id: agentId,
    residence_id: 'arcp:residence:00000000-0000-4000-8000-000000000502',
    manifest_version: version,
    parents: version > 1 ? [`arcp:manifest-version:${version - 1}`] : [],
    event_cursor: `arcp:event:${version}`,
    root_hash: `sha256:root-${version}`,
    policy_version: 1,
    lease_fencing_token: version,
    status: 'active',
  };
}

function event(id: string): EventEnvelope {
  return {
    schema: 'arcp/event/0.1',
    event_id: id,
    agent_id: agentId,
    event_type: 'test.event',
    causal_parent: null,
    producer: 'storage-contract-test',
    idempotency_key: `idem:${id}`,
    payload_hash: `sha256:${id}`,
    observed_at: { instant_id: `ctcl:instant:${id}` },
    received_local_time: '2026-08-17T04:30:00+08:00',
  };
}

describe('metadata store contract', () => {
  it('commits a manifest only when the expected version matches', async () => {
    const store = new InMemoryMetadataStore();

    await expect(store.compareAndSwapManifest(agentId, null, manifest(1))).resolves.toEqual({
      status: 'committed',
      manifest_version: 1,
    });
    await expect(store.compareAndSwapManifest(agentId, 1, manifest(2))).resolves.toEqual({
      status: 'committed',
      manifest_version: 2,
    });

    await expect(store.getManifest(agentId)).resolves.toEqual(manifest(2));
  });

  it('returns an explicit CAS conflict and leaves authoritative state unchanged', async () => {
    const store = new InMemoryMetadataStore();
    await store.compareAndSwapManifest(agentId, null, manifest(1));

    await expect(store.compareAndSwapManifest(agentId, null, manifest(2))).resolves.toEqual({
      status: 'conflict',
      actual_version: 1,
    });
    await expect(store.getManifest(agentId)).resolves.toEqual(manifest(1));
  });

  it('deduplicates append-only events explicitly and preserves append order', async () => {
    const store = new InMemoryMetadataStore();
    const first = event('arcp:event:storage-1');
    const second = event('arcp:event:storage-2');

    await expect(store.appendEvent(first)).resolves.toEqual({ status: 'appended' });
    await expect(store.appendEvent(first)).resolves.toEqual({ status: 'duplicate' });
    await expect(store.appendEvent(second)).resolves.toEqual({ status: 'appended' });

    await expect(store.listEvents(agentId)).resolves.toEqual([first, second]);
  });
});

describe('content-addressed object store contract', () => {
  it('distinguishes stored, already-existing, and digest-address conflicts', async () => {
    const store = new InMemoryObjectStore();
    const digest = 'sha256:object-address-test';
    const first = new Uint8Array([1, 2, 3]);
    const different = new Uint8Array([9, 9, 9]);

    await expect(store.put(digest, first)).resolves.toEqual({ status: 'stored', digest });
    await expect(store.put(digest, first)).resolves.toEqual({ status: 'already_exists', digest });
    await expect(store.put(digest, different)).resolves.toEqual({ status: 'conflict', digest });

    const loaded = await store.get(digest);
    expect(loaded).toEqual(first);
    expect(loaded).not.toBe(first);
    await expect(store.get('sha256:missing')).resolves.toBeNull();
  });
});
