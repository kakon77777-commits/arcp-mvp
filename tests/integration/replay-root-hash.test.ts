import { describe, expect, it } from 'vitest';
import { agentId, residenceId } from '@arcp/schema';
import { AgentCoordinator } from '@arcp/coordinator';
import { buildDeterministicTurnFixture } from '../helpers/build-turn-fixture.js';

/**
 * Phase 0 acceptance criterion (MVP spec §17):
 * "同一事件序列重放得到同一 root hash" — replaying the same event sequence
 * must produce the same commit root hash.
 */
describe('Phase 0 acceptance: replay determinism', () => {
  it('two independent coordinators processing the identical turn produce the identical root hash', () => {
    const agent = agentId('evemisslab', '00000000-0000-4000-8000-0000000000aa');
    const residence = residenceId('00000000-0000-4000-8000-0000000000bb');

    // Built ONCE: this is "the same event sequence" (same event_id, same
    // content hash, same everything). Building it twice would mint a fresh
    // ULID random tail each time — a different event, not a replay of it.
    const fixture = buildDeterministicTurnFixture(agent);

    const coordinatorA = new AgentCoordinator({ agentId: agent, residenceId: residence });
    const coordinatorB = new AgentCoordinator({ agentId: agent, residenceId: residence });

    const manifestA = coordinatorA.runTurn(fixture);
    const manifestB = coordinatorB.runTurn(fixture);

    expect(manifestA.root_hash).toBe(manifestB.root_hash);
    expect(manifestA.root_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('replaying the same turn a second time on a fresh coordinator (crash + full resync) still matches', () => {
    const agent = agentId('evemisslab', '00000000-0000-4000-8000-0000000000aa');
    const residence = residenceId('00000000-0000-4000-8000-0000000000bb');
    const fixture = buildDeterministicTurnFixture(agent);

    const before = new AgentCoordinator({ agentId: agent, residenceId: residence });
    const manifestBefore = before.runTurn(fixture);

    // Simulate "runtime destroyed, rebuilt from the same replayed event log":
    // a brand new coordinator replaying the exact same recorded event must
    // reach the exact same root hash, independent of process lifetime.
    const after = new AgentCoordinator({ agentId: agent, residenceId: residence });
    const manifestAfter = after.runTurn(fixture);

    expect(manifestAfter.root_hash).toBe(manifestBefore.root_hash);
  });
});
