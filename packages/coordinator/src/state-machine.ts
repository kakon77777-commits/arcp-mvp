/**
 * Agent turn state machine per
 * arcp_ctcl_internal_web_mvp_implementation_spec_v0.1.md §6 (stateDiagram-v2).
 */
export type AgentState =
  | 'Dormant'
  | 'Triggered'
  | 'Hydrating'
  | 'Deliberating'
  | 'Acting'
  | 'Committing'
  | 'Waiting'
  | 'Degraded'
  | 'Suspended';

const LEGAL_TRANSITIONS: Record<AgentState, AgentState[]> = {
  Dormant: ['Triggered'],
  Triggered: ['Hydrating', 'Degraded'],
  Hydrating: ['Deliberating'],
  Deliberating: ['Acting'],
  Acting: ['Committing', 'Suspended'],
  Committing: ['Dormant', 'Waiting', 'Suspended'],
  Waiting: ['Dormant', 'Triggered'],
  Degraded: [],
  Suspended: [],
};

export class IllegalStateTransitionError extends Error {
  constructor(
    public readonly from: AgentState,
    public readonly to: AgentState,
  ) {
    super(`illegal state transition: ${from} -> ${to}`);
    this.name = 'IllegalStateTransitionError';
  }
}

export function isLegalTransition(from: AgentState, to: AgentState): boolean {
  return (LEGAL_TRANSITIONS[from] ?? []).includes(to);
}

export function assertLegalTransition(from: AgentState, to: AgentState): void {
  if (!isLegalTransition(from, to)) {
    throw new IllegalStateTransitionError(from, to);
  }
}
