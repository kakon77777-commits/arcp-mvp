import { describe, expect, it } from 'vitest';
import { InMemoryMetadataStore } from '@arcp/control-plane-core';
import { AgentDurableObjectCore, AgentDurableObjectHandler } from '@arcp/adapter-cloudflare';
import type { ResidenceManifest, WakeRecord } from '@arcp/schema';

const AGENT_ID = 'arcp:agent:evemisslab:do-test';

interface WakeEnvelope {
  result: { status: string };
  commit_status: string;
}

function wake(overrides: Partial<WakeRecord> = {}): WakeRecord {
  return {
    schema: 'arcp/wake/0.1',
    wake_id: 'arcp:wake:00000000-0000-4000-8000-000000000001',
    trigger_type: 'schedule',
    trigger_ref: 'ctcl:instant:fake-000001',
    required_authority: 'internal-low-risk',
    revalidate_on_wake: true,
    idempotency_key: 'wake:daily-check:2026-08-17',
    ...overrides,
  };
}

function manifest(overrides: Partial<ResidenceManifest> = {}): ResidenceManifest {
  return {
    schema: 'arcp/residence-manifest/0.1',
    agent_id: AGENT_ID,
    residence_id: 'arcp:residence:do-test',
    manifest_version: 1,
    parents: [],
    event_cursor: 'arcp:event:genesis',
    root_hash: 'sha256:do-test',
    policy_version: 1,
    lease_fencing_token: 1,
    status: 'active',
    ...overrides,
  };
}

describe('AgentDurableObjectCore', () => {
  it('getManifest/getStatus are both null before any commit exists', async () => {
    const core = new AgentDurableObjectCore(new InMemoryMetadataStore());
    expect(await core.getManifest(AGENT_ID)).toBeNull();
    expect(await core.getStatus(AGENT_ID)).toBeNull();
  });

  it('getStatus derives a snapshot from the current manifest once one exists', async () => {
    const store = new InMemoryMetadataStore();
    await store.compareAndSwapManifest(AGENT_ID, null, manifest());
    const core = new AgentDurableObjectCore(store);

    const status = await core.getStatus(AGENT_ID);
    expect(status).toEqual({
      agent_id: AGENT_ID,
      state: 'Dormant',
      manifest_version: 1,
      root_hash: 'sha256:do-test',
    });
  });

  it('accepts a new wake, evaluates policy, and reports pending (not yet committed)', async () => {
    const core = new AgentDurableObjectCore(new InMemoryMetadataStore());
    const result = await core.acceptWake(AGENT_ID, wake());
    expect(result.status).toBe('accepted');
    expect(result.committed_version).toBeNull();
    expect(['allow', 'allow-with-log']).toContain(result.policy_decision);
  });

  it('redelivering the same wake idempotency_key reports duplicate, not a second accept', async () => {
    const core = new AgentDurableObjectCore(new InMemoryMetadataStore());
    const first = await core.acceptWake(AGENT_ID, wake());
    const second = await core.acceptWake(AGENT_ID, wake());
    expect(first.status).toBe('accepted');
    expect(second.status).toBe('duplicate');
  });

  it('a wake with a different idempotency_key is accepted independently', async () => {
    const core = new AgentDurableObjectCore(new InMemoryMetadataStore());
    const first = await core.acceptWake(AGENT_ID, wake({ idempotency_key: 'wake:a' }));
    const second = await core.acceptWake(AGENT_ID, wake({ idempotency_key: 'wake:b' }));
    expect(first.status).toBe('accepted');
    expect(second.status).toBe('accepted');
  });
});

describe('AgentDurableObjectHandler (internal HTTP surface)', () => {
  it('404s on an unrecognized internal route', async () => {
    const handler = new AgentDurableObjectHandler(new InMemoryMetadataStore());
    const response = await handler.fetch(new Request('https://coordinator.internal/internal/v1/nope'));
    expect(response.status).toBe(404);
  });

  it('GET manifest 404s before any commit, matching the public control-plane contract', async () => {
    const handler = new AgentDurableObjectHandler(new InMemoryMetadataStore());
    const response = await handler.fetch(
      new Request(`https://coordinator.internal/internal/v1/agents/${encodeURIComponent(AGENT_ID)}/manifest`),
    );
    expect(response.status).toBe(404);
  });

  it('POST wakes accepts a well-formed wake and returns 202 with commit_status pending_coordinator_commit', async () => {
    const handler = new AgentDurableObjectHandler(new InMemoryMetadataStore());
    const body = wake();
    const response = await handler.fetch(
      new Request(`https://coordinator.internal/internal/v1/agents/${encodeURIComponent(AGENT_ID)}/wakes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': body.idempotency_key },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(202);
    const parsed = (await response.json()) as WakeEnvelope;
    expect(parsed.result.status).toBe('accepted');
    expect(parsed.commit_status).toBe('pending_coordinator_commit');
  });

  it('redelivering the same wake over HTTP returns 200 with status duplicate', async () => {
    const store = new InMemoryMetadataStore();
    const handler = new AgentDurableObjectHandler(store);
    const body = wake();
    const request = () =>
      new Request(`https://coordinator.internal/internal/v1/agents/${encodeURIComponent(AGENT_ID)}/wakes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': body.idempotency_key },
        body: JSON.stringify(body),
      });

    await handler.fetch(request());
    const second = await handler.fetch(request());
    expect(second.status).toBe(200);
    const parsed = (await second.json()) as WakeEnvelope;
    expect(parsed.result.status).toBe('duplicate');
  });
});
