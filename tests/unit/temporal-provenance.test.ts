import { describe, expect, it } from 'vitest';
import { AgentCoordinator } from '@arcp/coordinator';
import { agentId, contentHash, eventId, residenceId } from '@arcp/schema';
import type { EventEnvelope, InstantRef } from '@arcp/schema';
import { buildDeterministicTurnFixture } from '../helpers/build-turn-fixture.js';

function makeCoordinator(seed: string): AgentCoordinator {
  return new AgentCoordinator({
    agentId: agentId('evemisslab', `00000000-0000-4000-8000-${seed.padStart(12, '0')}`),
    residenceId: residenceId(`00000000-0000-4000-8000-${String(Number(seed) + 1).padStart(12, '0')}`),
  });
}

describe('Phase 3 temporal provenance', () => {
  it('persists caller-supplied commit temporal evidence byte-for-byte', () => {
    const coordinator = makeCoordinator('301');
    const fixture = buildDeterministicTurnFixture(coordinator.agentId);
    const commitInstant: InstantRef = {
      instant_id: 'ctcl:instant:commit-1',
      timescale: 'utc',
      encoding: 'unix_ns',
      value: '9999999999999999999',
      source_quality: {
        source_class: 'edge_wall_clock',
        precision: 'millisecond_representation',
        estimated_uncertainty_ns: 5_000_000,
        synchronized: true,
      },
      attestation: {
        alg: 'Ed25519',
        key_id: 'ctcl-ed25519-1',
        signed_fields: 'instant_id|unix_ns|timescale',
        value: 'fixture-signature',
        verified: true,
      },
    };

    const manifest = coordinator.runTurn({ ...fixture, now: 1_000, commitInstant });

    expect(manifest.commit_instant).toEqual(commitInstant);
    expect(manifest.commit_instant).not.toBe(commitInstant);
  });

  it('keeps lease/fencing time controlled only by input.now, not commit evidence', () => {
    const coordinator = makeCoordinator('311');
    const fixture = buildDeterministicTurnFixture(coordinator.agentId);
    const commitInstant: InstantRef = {
      instant_id: 'ctcl:instant:far-future',
      timescale: 'utc',
      encoding: 'unix_ns',
      value: '9999999999999999999',
      source_quality: { source_class: 'edge_wall_clock', precision: 'millisecond_representation' },
    };

    coordinator.runTurn({ ...fixture, now: 1_000, commitInstant });

    expect(coordinator.lease.getCurrent()?.valid_from).toBe(new Date(1_000).toISOString());
    expect(coordinator.lease.getCurrent()?.valid_until).toBe(new Date(61_000).toISOString());
  });

  it('preserves the old manifest shape when commitInstant is omitted', () => {
    const coordinator = makeCoordinator('321');
    const manifest = coordinator.runTurn(buildDeterministicTurnFixture(coordinator.agentId));

    expect('commit_instant' in manifest).toBe(false);
  });

  it('models memory recall as an event observation without creating a new object version', () => {
    const coordinator = makeCoordinator('331');
    const fixture = buildDeterministicTurnFixture(coordinator.agentId);
    const recallEvent: EventEnvelope = {
      schema: 'arcp/event/0.1',
      event_id: eventId(1_700_000_123_456),
      agent_id: coordinator.agentId,
      event_type: 'memory.recalled',
      causal_parent: null,
      producer: 'test-recall',
      idempotency_key: 'recall:test:1',
      payload_hash: contentHash({ object: 'memory-1' }),
      observed_at: {
        instant_id: 'ctcl:instant:recall-1',
        timescale: 'utc',
        encoding: 'unix_ns',
        value: '1700000123456000000',
        source_quality: { source_class: 'edge_wall_clock', precision: 'millisecond_representation' },
      },
      received_local_time: '2026-08-18T00:00:00.000+08:00',
    };

    coordinator.runTurn({
      ...fixture,
      events: [recallEvent],
      objectVersions: [],
      actions: [],
      wake: { ...fixture.wake, idempotency_key: 'wake:recall:test:1' },
    });

    expect(coordinator.store.events).toEqual([recallEvent]);
    expect(coordinator.store.objectVersions).toHaveLength(0);
  });
});
