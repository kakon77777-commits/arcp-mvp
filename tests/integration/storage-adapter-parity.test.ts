import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  InMemoryMetadataStore,
  InMemoryObjectStore,
  type MetadataStorePort,
  type ObjectStorePort,
} from '@arcp/control-plane-core';
import { D1MetadataStore, R2ObjectStore } from '@arcp/adapter-cloudflare';
import type { EventEnvelope, ResidenceManifest } from '@arcp/schema';
import { createFakeD1Database } from '../helpers/fake-d1-database.js';
import { createFakeR2Bucket } from '../helpers/fake-r2-bucket.js';

const migrationPath = fileURLToPath(new URL('../../migrations/d1/0001_init.sql', import.meta.url));
const migrationSql = readFileSync(migrationPath, 'utf-8');

function manifest(overrides: Partial<ResidenceManifest> = {}): ResidenceManifest {
  return {
    schema: 'arcp/residence-manifest/0.1',
    agent_id: 'arcp:agent:evemisslab:parity',
    residence_id: 'arcp:residence:parity',
    manifest_version: 1,
    parents: [],
    event_cursor: 'arcp:event:genesis',
    root_hash: 'sha256:parity',
    policy_version: 1,
    lease_fencing_token: 1,
    status: 'active',
    ...overrides,
  };
}

function event(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    schema: 'arcp/event/0.1',
    event_id: 'arcp:event:01PARITYAAAAAAAAAAAAAAAAAA',
    agent_id: 'arcp:agent:evemisslab:parity',
    event_type: 'parity.event',
    causal_parent: null,
    producer: 'test',
    idempotency_key: 'evt:parity:1',
    payload_hash: 'sha256:parity-payload',
    observed_at: { instant_id: 'ctcl:instant:fake-000001' },
    received_local_time: '2026-08-17T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Task 5B acceptance: the durable (D1/R2) adapters must satisfy exactly the
 * same port contract as the in-memory reference implementations used
 * throughout Phase 0/1's tests. Same assertions, two backends, driven from
 * one shared body so the contract can't silently drift between them.
 */
const metadataStoreBackends: Array<[string, () => MetadataStorePort]> = [
  ['InMemoryMetadataStore', () => new InMemoryMetadataStore()],
  ['D1MetadataStore', () => new D1MetadataStore(createFakeD1Database(migrationSql))],
];

describe.each(metadataStoreBackends)('MetadataStorePort parity: %s', (_name, makeStore) => {
  it('getManifest is null before any write', async () => {
    const store = makeStore();
    expect(await store.getManifest('arcp:agent:evemisslab:parity')).toBeNull();
  });

  it('first CAS write commits, second first-write CAS conflicts', async () => {
    const store = makeStore();
    const first = await store.compareAndSwapManifest('arcp:agent:evemisslab:parity', null, manifest());
    expect(first).toEqual({ status: 'committed', manifest_version: 1 });

    const second = await store.compareAndSwapManifest(
      'arcp:agent:evemisslab:parity',
      null,
      manifest({ manifest_version: 2 }),
    );
    expect(second).toEqual({ status: 'conflict', actual_version: 1 });
  });

  it('stale-version CAS is fenced, current version is preserved', async () => {
    const store = makeStore();
    await store.compareAndSwapManifest('arcp:agent:evemisslab:parity', null, manifest());
    await store.compareAndSwapManifest(
      'arcp:agent:evemisslab:parity',
      1,
      manifest({ manifest_version: 2, root_hash: 'sha256:second' }),
    );

    const stale = await store.compareAndSwapManifest(
      'arcp:agent:evemisslab:parity',
      1,
      manifest({ manifest_version: 3 }),
    );
    expect(stale).toEqual({ status: 'conflict', actual_version: 2 });
    expect((await store.getManifest('arcp:agent:evemisslab:parity'))?.root_hash).toBe('sha256:second');
  });

  it('appendEvent is idempotent by event_id, listEvents returns only that agent', async () => {
    const store = makeStore();
    expect(await store.appendEvent(event())).toEqual({ status: 'appended' });
    expect(await store.appendEvent(event())).toEqual({ status: 'duplicate' });
    await store.appendEvent(event({ agent_id: 'arcp:agent:evemisslab:other', event_id: 'arcp:event:01PARITYBBBBBBBBBBBBBBBBBB' }));

    const events = await store.listEvents('arcp:agent:evemisslab:parity');
    expect(events).toHaveLength(1);
    expect(events[0]?.event_id).toBe(event().event_id);
  });
});

const objectStoreBackends: Array<[string, () => ObjectStorePort]> = [
  ['InMemoryObjectStore', () => new InMemoryObjectStore()],
  ['R2ObjectStore', () => new R2ObjectStore(createFakeR2Bucket())],
];

describe.each(objectStoreBackends)('ObjectStorePort parity: %s', (_name, makeStore) => {
  const enc = (text: string) => new TextEncoder().encode(text);

  it('get is null before any put', async () => {
    const store = makeStore();
    expect(await store.get('sha256:parity-missing')).toBeNull();
  });

  it('put/get round-trips bytes and reports stored on first write', async () => {
    const store = makeStore();
    expect(await store.put('sha256:parity-a', enc('payload'))).toEqual({
      status: 'stored',
      digest: 'sha256:parity-a',
    });
    expect(await store.get('sha256:parity-a')).toEqual(enc('payload'));
  });

  it('identical re-put reports already_exists; differing re-put reports conflict and does not overwrite', async () => {
    const store = makeStore();
    await store.put('sha256:parity-a', enc('payload'));

    expect(await store.put('sha256:parity-a', enc('payload'))).toEqual({
      status: 'already_exists',
      digest: 'sha256:parity-a',
    });
    expect(await store.put('sha256:parity-a', enc('different'))).toEqual({
      status: 'conflict',
      digest: 'sha256:parity-a',
    });
    expect(await store.get('sha256:parity-a')).toEqual(enc('payload'));
  });
});
