import { describe, expect, it } from 'vitest';
import { agentId, residenceId } from '@arcp/schema';
import type { ObjectVersion } from '@arcp/schema';
import { AgentCoordinator, StaleFencingTokenError } from '@arcp/coordinator';
import { buildDeterministicTurnFixture } from '../helpers/build-turn-fixture.js';

describe('turn commit atomicity', () => {
  it('leaves no partial durable state when commit preparation fails', () => {
    const agent = agentId('evemisslab', '00000000-0000-4000-8000-000000000201');
    const residence = residenceId('00000000-0000-4000-8000-000000000202');
    const coordinator = new AgentCoordinator({ agentId: agent, residenceId: residence });
    const fixture = buildDeterministicTurnFixture(agent);

    const poisonedVersion = { ...fixture.objectVersions[0] } as ObjectVersion;
    Object.defineProperty(poisonedVersion, 'object_id', {
      enumerable: true,
      get() {
        throw new Error('synthetic root-hash failure');
      },
    });
    fixture.objectVersions = [poisonedVersion];

    expect(() => coordinator.runTurn(fixture)).toThrow('synthetic root-hash failure');

    expect(coordinator.store.events).toHaveLength(0);
    expect(coordinator.store.objectVersions).toHaveLength(0);
    expect(coordinator.store.manifests).toHaveLength(0);
    expect(coordinator.store.isDuplicateWake(fixture.wake.idempotency_key)).toBe(false);
    expect(coordinator.store.isDuplicateAction(fixture.actions[0]!.idempotency_key)).toBe(false);
    expect(coordinator.state).toBe('Suspended');
  });

  it('rejects a turn whose lease fencing token was superseded before commit', () => {
    const agent = agentId('evemisslab', '00000000-0000-4000-8000-000000000211');
    const residence = residenceId('00000000-0000-4000-8000-000000000212');
    const coordinator = new AgentCoordinator({ agentId: agent, residenceId: residence });
    const fixture = buildDeterministicTurnFixture(agent);

    const acquire = coordinator.lease.acquire.bind(coordinator.lease);
    coordinator.lease.acquire = ((holder, scope, ttlMs, now) => {
      const staleLease = acquire(holder, scope, ttlMs, now);
      acquire('competing-writer', scope, ttlMs, (now ?? Date.now()) + 1);
      return staleLease;
    }) as typeof coordinator.lease.acquire;

    expect(() => coordinator.runTurn(fixture)).toThrow(StaleFencingTokenError);

    expect(coordinator.store.events).toHaveLength(0);
    expect(coordinator.store.objectVersions).toHaveLength(0);
    expect(coordinator.store.manifests).toHaveLength(0);
    expect(coordinator.store.isDuplicateWake(fixture.wake.idempotency_key)).toBe(false);
    expect(coordinator.store.isDuplicateAction(fixture.actions[0]!.idempotency_key)).toBe(false);
    expect(coordinator.state).toBe('Suspended');
  });
});
