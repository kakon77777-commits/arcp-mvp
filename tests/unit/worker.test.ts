import { describe, expect, it } from 'vitest';
import {
  ArcpAgentDurableObject,
  createArcpWorkerHandler,
  type ArcpWorkerEnv,
  type DurableObjectNamespaceLike,
  type DurableObjectStubLike,
} from '@arcp/adapter-cloudflare';
import { createFakeD1Database } from '../helpers/fake-d1-database.js';

const migrationSql = `
CREATE TABLE IF NOT EXISTS residence_manifests (
  agent_id TEXT PRIMARY KEY NOT NULL,
  manifest_version INTEGER NOT NULL,
  manifest_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS residence_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL,
  event_json TEXT NOT NULL,
  inserted_at TEXT NOT NULL
);
`;

const AGENT_ID = 'arcp:agent:evemisslab:worker-test';

/** Wires a real ArcpAgentDurableObject (backed by a fake D1) behind an in-memory namespace. */
function createTestNamespace(): DurableObjectNamespaceLike {
  const instances = new Map<string, DurableObjectStubLike>();
  return {
    getByName(name: string): DurableObjectStubLike {
      let instance = instances.get(name);
      if (!instance) {
        const durableObject = new ArcpAgentDurableObject(undefined, { DB: createFakeD1Database(migrationSql) });
        instance = { fetch: (request: Request) => durableObject.fetch(request) };
        instances.set(name, instance);
      }
      return instance;
    },
  };
}

describe('createArcpWorkerHandler (public /api/v1 surface end-to-end)', () => {
  function makeEnv(): ArcpWorkerEnv {
    return { AGENTS: createTestNamespace() };
  }

  it('rejects manifest reads without an Authorization header', async () => {
    const handler = createArcpWorkerHandler(makeEnv());
    const response = await handler.fetch(
      new Request(`https://worker.internal/api/v1/agents/${encodeURIComponent(AGENT_ID)}/manifest`),
    );
    expect(response.status).toBe(401);
  });

  it('404s a manifest read for an agent that has never accepted a wake', async () => {
    const handler = createArcpWorkerHandler(makeEnv());
    const response = await handler.fetch(
      new Request(`https://worker.internal/api/v1/agents/${encodeURIComponent(AGENT_ID)}/manifest`, {
        headers: { Authorization: 'Bearer test' },
      }),
    );
    expect(response.status).toBe(404);
  });

  it('accepts a wake end-to-end through Worker -> transport -> Durable Object -> D1', async () => {
    const handler = createArcpWorkerHandler(makeEnv());
    const wake = {
      schema: 'arcp/wake/0.1',
      wake_id: 'arcp:wake:00000000-0000-4000-8000-000000000099',
      trigger_type: 'schedule',
      trigger_ref: 'ctcl:instant:fake-000001',
      required_authority: 'internal-low-risk',
      revalidate_on_wake: true,
      idempotency_key: 'wake:worker-e2e:1',
    };

    const response = await handler.fetch(
      new Request(`https://worker.internal/api/v1/agents/${encodeURIComponent(AGENT_ID)}/wakes`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
          'Idempotency-Key': wake.idempotency_key,
        },
        body: JSON.stringify(wake),
      }),
    );
    expect(response.status).toBe(202);

    // Redelivering the identical wake through the full stack must still dedupe.
    const replay = await handler.fetch(
      new Request(`https://worker.internal/api/v1/agents/${encodeURIComponent(AGENT_ID)}/wakes`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
          'Idempotency-Key': wake.idempotency_key,
        },
        body: JSON.stringify(wake),
      }),
    );
    expect(replay.status).toBe(200);
    const body = (await replay.json()) as { result: { status: string } };
    expect(body.result.status).toBe('duplicate');
  });
});
