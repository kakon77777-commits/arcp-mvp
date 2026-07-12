import { describe, expect, it } from 'vitest';
import { assertLegalTransition, IllegalStateTransitionError, isLegalTransition } from '@arcp/coordinator';

describe('agent turn state machine', () => {
  it('allows the standard turn path Dormant -> ... -> Dormant', () => {
    const path = ['Dormant', 'Triggered', 'Hydrating', 'Deliberating', 'Acting', 'Committing', 'Dormant'] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(isLegalTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it('allows Acting -> Suspended (policy or budget stop)', () => {
    expect(isLegalTransition('Acting', 'Suspended')).toBe(true);
  });

  it('allows Triggered -> Degraded (validation failed)', () => {
    expect(isLegalTransition('Triggered', 'Degraded')).toBe(true);
  });

  it('rejects skipping straight from Dormant to Acting', () => {
    expect(isLegalTransition('Dormant', 'Acting')).toBe(false);
    expect(() => assertLegalTransition('Dormant', 'Acting')).toThrow(IllegalStateTransitionError);
  });

  it('rejects going backwards from Committing to Acting', () => {
    expect(isLegalTransition('Committing', 'Acting')).toBe(false);
  });

  it('rejects any transition out of a terminal Degraded/Suspended state', () => {
    expect(isLegalTransition('Degraded', 'Dormant')).toBe(false);
    expect(isLegalTransition('Suspended', 'Dormant')).toBe(false);
  });
});
