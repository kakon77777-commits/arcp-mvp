import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { D1MetadataStore } from '@arcp/adapter-cloudflare';
import type { EventEnvelope, ResidenceManifest } from '@arcp/schema';
import { createFakeD1Database } from '../helpers/fake-d1-database.js';

const migrationPath = fileURLToPath(
  new URL('../../migrations/d1/0001_init.sql', import.meta.url),
);
const migrationSql = readFileSync(migrationPath, 'utf-8');

function manifest(overrides: Partial<ResidenceManifest> = {}): ResidenceManifest {
  return {
    schema: 'arcp/residence-manifest/0.1',
    agent_id: 'arcp:agent:evemisslab:test',
    residence_id: 'arcp:residence:test',
    manifest_version: 1,
    parents: [],
    event_cursor: 'arcp:event:genesis',
    root_hash: 'sha256:aaa',
    policy_version: 1,
    lease_fencing_token: 1,
    status: 'active',
    ...overrides,
  };
}

function event(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    schema: 'arcp/event/0.1',
    event_id: 'arcp:event:01AAAAAAAAAAAAAAAAAAAAAAAA',
    agent_id: 'arcp:agent:evemisslab:test',
    event_type: 'test.event',
    causal_parent: null,
    producer: 'test',
    idempotency_key: 'evt:1',
    payload_hash: 'sha256:bbb',
    observed_at: { instant_id: 'ctcl:instant:fake-000001' },
    received_local_time: '2026-08-17T00:00:00.000Z',
    ...overrides,
  };
}

describe('D1MetadataStore', () => {
  it('getManifest returns null for an unknown agent', async () => {
    const store = new D1MetadataStore(createFakeD1Database(migrationSql));
    expect(await store.getManifest('arcp:agent:evemisslab:test')).toBeNull();
  });

  it('first-write CAS (expectedVersion null) succeeds when no row exists', async () => {
    const store = new D1MetadataStore(createFakeD1Database(migrationSql));
    const result = await store.compareAndSwapManifest('arcp:agent:evemisslab:test', null, manifest());
    expect(result).toEqual({ status: 'committed', manifest_version: 1 });
    expect(await store.getManifest('arcp:agent:evemisslab:test')).toEqual(manifest());
  });

  it('first-write CAS fails with conflict when a row already exists', async () => {
    const store = new D1MetadataStore(createFakeD1Database(migrationSql));
    await store.compareAndSwapManifest('arcp:agent:evemisslab:test', null, manifest());
    const result = await store.compareAndSwapManifest('arcp:agent:evemisslab:test', null, manifest({ manifest_version: 2 }));
    expect(result).toEqual({ status: 'conflict', actual_version: 1 });
  });

  it('subsequent CAS succeeds when expectedVersion matches the stored version', async () => {
    const store = new D1MetadataStore(createFakeD1Database(migrationSql));
    await store.compareAndSwapManifest('arcp:agent:evemisslab:test', null, manifest());
    const result = await store.compareAndSwapManifest(
      'arcp:agent:evemisslab:test',
      1,
      manifest({ manifest_version: 2, root_hash: 'sha256:ccc' }),
    );
    expect(result).toEqual({ status: 'committed', manifest_version: 2 });
  });

  it('subsequent CAS rejects a stale expectedVersion, preserving the authoritative row', async () => {
    const store = new D1MetadataStore(createFakeD1Database(migrationSql));
    await store.compareAndSwapManifest('arcp:agent:evemisslab:test', null, manifest());
    await store.compareAndSwapManifest('arcp:agent:evemisslab:test', 1, manifest({ manifest_version: 2 }));

    // A second writer still thinks version 1 is current -> must be fenced out.
    const result = await store.compareAndSwapManifest('arcp:agent:evemisslab:test', 1, manifest({ manifest_version: 2 }));
    expect(result).toEqual({ status: 'conflict', actual_version: 2 });
    expect((await store.getManifest('arcp:agent:evemisslab:test'))?.manifest_version).toBe(2);
  });

  it('rejects a manifest whose agent_id does not match the CAS key', async () => {
    const store = new D1MetadataStore(createFakeD1Database(migrationSql));
    await expect(
      store.compareAndSwapManifest('arcp:agent:evemisslab:other', null, manifest()),
    ).rejects.toThrow();
  });

  it('appendEvent appends new events and reports duplicates without overwriting', async () => {
    const store = new D1MetadataStore(createFakeD1Database(migrationSql));
    expect(await store.appendEvent(event())).toEqual({ status: 'appended' });
    expect(await store.appendEvent(event())).toEqual({ status: 'duplicate' });
    expect(await store.listEvents('arcp:agent:evemisslab:test')).toEqual([event()]);
  });

  it('listEvents returns only events for the requested agent, in insertion order', async () => {
    const store = new D1MetadataStore(createFakeD1Database(migrationSql));
    await store.appendEvent(event({ event_id: 'arcp:event:01AAAAAAAAAAAAAAAAAAAAAAAA' }));
    await store.appendEvent(event({ event_id: 'arcp:event:01BBBBBBBBBBBBBBBBBBBBBBBB' }));
    await store.appendEvent(event({ agent_id: 'arcp:agent:evemisslab:other', event_id: 'arcp:event:01CCCCCCCCCCCCCCCCCCCCCCCC' }));

    const events = await store.listEvents('arcp:agent:evemisslab:test');
    expect(events.map((e) => e.event_id)).toEqual([
      'arcp:event:01AAAAAAAAAAAAAAAAAAAAAAAA',
      'arcp:event:01BBBBBBBBBBBBBBBBBBBBBBBB',
    ]);
  });
});
