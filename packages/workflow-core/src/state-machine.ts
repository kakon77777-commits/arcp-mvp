import type { RunPhase } from '@arcp/schema';

const LEGAL_RUN_TRANSITIONS: Record<RunPhase, RunPhase[]> = {
  accepted: ['hydrating', 'contained', 'failed', 'dead-lettered'],
  hydrating: ['deliberating', 'contained', 'failed', 'dead-lettered'],
  deliberating: ['authorizing', 'committing', 'waiting', 'contained', 'completed', 'failed', 'dead-lettered'],
  authorizing: ['deliberating', 'waiting-approval', 'executing', 'contained', 'completed', 'failed', 'dead-lettered'],
  'waiting-approval': ['authorizing', 'contained', 'failed', 'dead-lettered'],
  executing: ['deliberating', 'reconciling', 'committing', 'contained', 'failed', 'dead-lettered'],
  reconciling: ['deliberating', 'committing', 'waiting', 'contained', 'failed', 'dead-lettered'],
  committing: ['deliberating', 'waiting', 'contained', 'completed', 'failed', 'dead-lettered'],
  waiting: ['hydrating', 'deliberating', 'authorizing', 'contained', 'completed', 'failed', 'dead-lettered'],
  contained: ['hydrating', 'deliberating', 'authorizing', 'reconciling', 'committing', 'waiting', 'completed', 'failed', 'dead-lettered'],
  completed: [],
  'dead-lettered': [],
  failed: [],
};

export class RunPhaseTransitionError extends Error {
  constructor(
    public readonly from: RunPhase,
    public readonly to: RunPhase,
  ) {
    super(`illegal run phase transition: ${from} -> ${to}`);
    this.name = 'RunPhaseTransitionError';
  }
}

export function isRunPhaseTransitionAllowed(from: RunPhase, to: RunPhase): boolean {
  return LEGAL_RUN_TRANSITIONS[from].includes(to);
}

export function assertRunPhaseTransition(from: RunPhase, to: RunPhase): void {
  if (!isRunPhaseTransitionAllowed(from, to)) {
    throw new RunPhaseTransitionError(from, to);
  }
}

export function legalRunTransitionsFrom(from: RunPhase): readonly RunPhase[] {
  return LEGAL_RUN_TRANSITIONS[from];
}
