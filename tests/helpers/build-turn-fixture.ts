import { contentHash, eventId, objectId } from '@arcp/schema';
import type { ActionIntent, EventEnvelope, ObjectVersion, WakeRecord } from '@arcp/schema';
import type { AgentTurnInput } from '@arcp/coordinator';

/**
 * Builds a fully deterministic single-turn fixture: fixed IDs, fixed content,
 * fixed fake CTCL instant — no Date.now()/crypto randomness anywhere. Used by
 * the replay-determinism test, which requires the exact same input to yield
 * the exact same root hash across two independent coordinator instances.
 */
export function buildDeterministicTurnFixture(agentId: string): AgentTurnInput {
  const fixedObjectId = objectId('00000000-0000-4000-8000-000000000001');
  const version: ObjectVersion = {
    schema: 'arcp/object-version/0.1',
    object_id: fixedObjectId,
    object_type: 'document',
    version: 1,
    parents: [],
    content_hash: contentHash({ text: 'fixed replay fixture content' }),
    canonical_role: 'canonical',
    sensitivity: 'P0',
    provenance: { source_type: 'created', created_by: agentId },
    status: 'active',
  };

  const event: EventEnvelope = {
    schema: 'arcp/event/0.1',
    event_id: eventId(1_700_000_000_000),
    agent_id: agentId,
    event_type: 'object.import.completed',
    causal_parent: null,
    producer: 'test-fixture',
    idempotency_key: `fixture:${fixedObjectId}:v1`,
    payload_hash: contentHash({ note: 'fixture payload' }),
    observed_at: { instant_id: 'ctcl:instant:fake-000001', timescale: 'utc', encoding: 'unix_ms' },
    received_local_time: '2026-07-12T10:00:00.000Z',
  };

  const wake: WakeRecord = {
    schema: 'arcp/wake/0.1',
    wake_id: 'arcp:wake:00000000-0000-4000-8000-000000000002',
    trigger_type: 'schedule',
    trigger_ref: 'ctcl:instant:fake-000001',
    required_authority: 'internal-low-risk',
    revalidate_on_wake: true,
    idempotency_key: 'wake:daily-check:2026-07-12',
  };

  const action: ActionIntent = {
    action_id: 'arcp:action:00000000-0000-4000-8000-000000000003',
    actor: agentId,
    intent: 'index.rebuild',
    target: fixedObjectId,
    sensitivity: 'P0',
    risk: 'R0',
    reversibility: 'reversible',
    requested_scopes: [],
    idempotency_key: `action:${fixedObjectId}:reindex:1`,
  };

  return {
    wake,
    events: [event],
    objectVersions: [version],
    actions: [action],
    now: 1_700_000_000_000,
  };
}
