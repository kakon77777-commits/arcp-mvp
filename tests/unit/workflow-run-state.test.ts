import { describe, expect, it } from 'vitest';
import {
  RunPhaseTransitionError,
  assertRunPhaseTransition,
  isRunPhaseTransitionAllowed,
} from '@arcp/workflow-core';

describe('Phase 4 run phase machine', () => {
  it('allows the designed resumable transitions', () => {
    const allowed = [
      ['accepted', 'hydrating'],
      ['hydrating', 'deliberating'],
      ['deliberating', 'authorizing'],
      ['authorizing', 'waiting-approval'],
      ['waiting-approval', 'authorizing'],
      ['authorizing', 'executing'],
      ['executing', 'reconciling'],
      ['executing', 'committing'],
      ['reconciling', 'committing'],
      ['committing', 'deliberating'],
      ['committing', 'completed'],
      ['authorizing', 'contained'],
      ['executing', 'contained'],
      ['contained', 'authorizing'],
    ] as const;

    for (const [from, to] of allowed) {
      expect(isRunPhaseTransitionAllowed(from, to), `${from} -> ${to}`).toBe(true);
      expect(() => assertRunPhaseTransition(from, to)).not.toThrow();
    }
  });

  it('keeps terminal phases terminal and rejects illegal jumps', () => {
    expect(() => assertRunPhaseTransition('completed', 'deliberating')).toThrow(
      RunPhaseTransitionError,
    );
    expect(() => assertRunPhaseTransition('dead-lettered', 'executing')).toThrow(
      RunPhaseTransitionError,
    );
    expect(() => assertRunPhaseTransition('accepted', 'executing')).toThrow(
      RunPhaseTransitionError,
    );
  });
});
