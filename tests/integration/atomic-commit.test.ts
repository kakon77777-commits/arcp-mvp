import { describe, expect, it } from 'vitest';
import { agentId, residenceId } from '@arcp/schema';
import type { ObjectVersion } from '@arcp/schema';
import { AgentCoordinator } from '@arcp/coordinator';
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
});
