import { describe, expect, it } from 'vitest';
import { agentId, residenceId } from '@arcp/schema';
import { AgentCoordinator, DuplicateActionError, IllegalStateTransitionError } from '@arcp/coordinator';
import { buildDeterministicTurnFixture } from '../helpers/build-turn-fixture.js';

/**
 * Phase 0 acceptance criterion (MVP spec §17):
 * "非法狀態轉移與重複 action 被拒絕" — illegal state transitions and
 * duplicate actions are rejected. Also covers integration test #1 from §16.3:
 * "同一 wake 被投遞三次，只產生一個 run".
 */
describe('Phase 0 acceptance: illegal transitions and duplicate actions rejected', () => {
  it('redelivering the same wake three times produces exactly one run', () => {
    const agent = agentId('evemisslab', '00000000-0000-4000-8000-0000000000cc');
    const residence = residenceId('00000000-0000-4000-8000-0000000000dd');
    const coordinator = new AgentCoordinator({ agentId: agent, residenceId: residence });
    const fixture = buildDeterministicTurnFixture(agent);

    const first = coordinator.runTurn(fixture);
    const second = coordinator.runTurn(fixture); // redelivered, same wake.idempotency_key
    const third = coordinator.runTurn(fixture); // redelivered again

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(coordinator.store.manifests).toHaveLength(1);
  });

  it('rejects a duplicate action idempotency key across two different wakes', () => {
    const agent = agentId('evemisslab', '00000000-0000-4000-8000-0000000000ee');
    const residence = residenceId('00000000-0000-4000-8000-0000000000ff');
    const coordinator = new AgentCoordinator({ agentId: agent, residenceId: residence });

    const firstTurn = buildDeterministicTurnFixture(agent);
    coordinator.runTurn(firstTurn);

    const secondTurn = buildDeterministicTurnFixture(agent);
    secondTurn.wake = { ...secondTurn.wake, idempotency_key: 'wake:daily-check:2026-07-13' }; // new wake
    // ...but reuses the exact same action idempotency_key as the first turn.

    expect(() => coordinator.runTurn(secondTurn)).toThrow(DuplicateActionError);
    expect(coordinator.store.manifests).toHaveLength(1); // the duplicate never committed
  });

  it('the coordinator never allows an illegal state transition to occur mid-turn', () => {
    const agent = agentId('evemisslab', '00000000-0000-4000-8000-000000000101');
    const residence = residenceId('00000000-0000-4000-8000-000000000102');
    const coordinator = new AgentCoordinator({ agentId: agent, residenceId: residence });

    expect(coordinator.state).toBe('Dormant');
    coordinator.runTurn(buildDeterministicTurnFixture(agent));
    expect(coordinator.state).toBe('Dormant');
  });

  it('IllegalStateTransitionError is thrown by the underlying state machine guard', async () => {
    const { assertLegalTransition } = await import('@arcp/coordinator');
    expect(() => assertLegalTransition('Dormant', 'Committing')).toThrow(IllegalStateTransitionError);
  });
});
