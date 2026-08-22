import type { ActionIntent } from '@arcp/schema';
import { WorkflowError } from '@arcp/workflow-core';
import type {
  ModelCallLimits,
  ModelPort,
  ModelTurnInput,
  ModelTurnProposal,
  PreparedModelCall,
} from '@arcp/workflow-core';

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

type ModelCallLimitName = keyof ModelCallLimits;

export interface DeterministicModelAdapterOptions {
  unsupportedLimits?: ModelCallLimitName[];
}

export interface DeterministicModelPreparation {
  input: ModelTurnInput;
  limits: ModelCallLimits;
}

const LEGACY_TEST_LIMITS: ModelCallLimits = Object.freeze({
  maxOutputTokens: Number.MAX_SAFE_INTEGER,
  maxInputTokens: Number.MAX_SAFE_INTEGER,
  maxCostMicros: Number.MAX_SAFE_INTEGER,
  maxActiveDurationMs: Number.MAX_SAFE_INTEGER,
});

export class DeterministicModelAdapter implements ModelPort {
  private cursor = 0;
  readonly invocations: ModelTurnInput[] = [];
  readonly preparations: DeterministicModelPreparation[] = [];
  executions = 0;

  constructor(
    private readonly script: DeterministicModelStep[],
    private readonly options: DeterministicModelAdapterOptions = {},
  ) {}

  async prepareCall(input: ModelTurnInput, limits: ModelCallLimits): Promise<PreparedModelCall> {
    this.preparations.push({
      input: structuredClone(input),
      limits: structuredClone(limits),
    });

    for (const [name, value] of Object.entries(limits) as Array<[ModelCallLimitName, number]>) {
      if (!Number.isFinite(value) || value < 0) {
        throw new WorkflowError(
          'model_limit_contract_violated',
          `invalid finite model call limit ${name}: ${String(value)}`,
          false,
        );
      }
    }

    for (const name of this.options.unsupportedLimits ?? []) {
      if (Number.isFinite(limits[name])) {
        throw new WorkflowError(
          'model_limit_unsupported',
          `deterministic adapter cannot enforce ${name}`,
          false,
        );
      }
    }

    let executed = false;
    return {
      execute: async (): Promise<ModelTurnProposal> => {
        if (executed) {
          throw new WorkflowError(
            'model_limit_contract_violated',
            'prepared model call may execute at most once',
            false,
          );
        }
        executed = true;
        this.executions += 1;
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
      },
    };
  }

  /**
   * Temporary Phase 4 compatibility. Task 7 removes orchestrator dependence on
   * this path; the large limits below are deterministic-test scaffolding, not a
   * runtime security boundary.
   */
  async deliberate(input: ModelTurnInput): Promise<ModelTurnProposal> {
    const prepared = await this.prepareCall(input, LEGACY_TEST_LIMITS);
    return prepared.execute();
  }

  reset(): void {
    this.cursor = 0;
    this.invocations.length = 0;
    this.preparations.length = 0;
    this.executions = 0;
  }
}
