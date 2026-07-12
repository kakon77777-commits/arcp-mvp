import type { ActionIntent } from '@arcp/schema';

/**
 * Fake model adapter for Phase 0. The model layer only ever proposes action
 * intents (§2.4) — it never gets a live connector. A scripted, ordered list
 * of turns keeps the whole loop deterministic for replay tests.
 */
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

export class FakeModelAdapter {
  private cursor = 0;

  constructor(private readonly script: ScriptedTurn[]) {}

  nextTurn(): ScriptedTurn {
    const turn = this.script[this.cursor];
    if (!turn) throw new ScriptExhaustedError();
    this.cursor += 1;
    return turn;
  }

  reset(): void {
    this.cursor = 0;
  }
}
