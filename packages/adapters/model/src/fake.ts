import type { ActionIntent } from '@arcp/schema';
import type { ModelPort, ModelTurnInput, ModelTurnProposal } from '@arcp/workflow-core';

/** Phase 0 compatibility scripted turn. */
export interface ScriptedTurn {
  actionIntents: ActionIntent[];
  memoryProposals?: unknown[];
}

export class ScriptExhaustedError extends Error {
  constructor() {
    super('fake model script exhausted: no more scripted turns available');
    this.name = 'ScriptExhaustedError';
  }
}

/**
 * Phase 0 synchronous compatibility adapter. Existing replay tests continue to
 * use this surface; Phase 4 code should prefer DeterministicModelAdapter.
 */
export class FakeModelAdapter {
  private cursor = 0;

  constructor(private readonly script: ScriptedTurn[]) {}

  nextTurn(): ScriptedTurn {
    const turn = this.script[this.cursor];
    if (!turn) throw new ScriptExhaustedError();
    this.cursor += 1;
    return structuredClone(turn);
  }

  reset(): void {
    this.cursor = 0;
  }
}

export type DeterministicModelStep =
  | ModelTurnProposal
  | { error: 'temporarily-unavailable'; message?: string }
  | { error: 'ambiguous'; message?: string };

export class DeterministicModelAdapter implements ModelPort {
  private cursor = 0;
  readonly invocations: ModelTurnInput[] = [];

  constructor(private readonly script: DeterministicModelStep[]) {}

  async deliberate(input: ModelTurnInput): Promise<ModelTurnProposal> {
    this.invocations.push(structuredClone(input));
    const step = this.script[this.cursor];
    if (!step) throw new ScriptExhaustedError();
    this.cursor += 1;

    if ('error' in step) {
      const error = new Error(step.message ?? step.error);
      error.name = step.error === 'ambiguous' ? 'AmbiguousModelInvocationError' : 'ModelTemporarilyUnavailableError';
      throw error;
    }

    return structuredClone(step);
  }

  reset(): void {
    this.cursor = 0;
    this.invocations.length = 0;
  }
}
