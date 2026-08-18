import type {
  ActionExecutorPort,
  ActionReconcileInput,
  ActionReconcileResult,
  AuthorizedActionExecution,
  ActionExecutionResult,
} from '@arcp/workflow-core';

export type RecordingExecutorMode =
  | 'succeed'
  | 'fail'
  | 'partial'
  | 'unknown'
  | 'effect-then-throw';

export class InjectedCrashAfterEffectError extends Error {
  constructor() {
    super('injected crash after external effect and before receipt persistence');
    this.name = 'InjectedCrashAfterEffectError';
  }
}

export class RecordingActionExecutor implements ActionExecutorPort {
  readonly executeCalls: AuthorizedActionExecution[] = [];
  readonly reconcileCalls: ActionReconcileInput[] = [];
  readonly appliedEffects = new Map<string, { providerOperationId: string; externalRef: string }>();

  constructor(
    public mode: RecordingExecutorMode = 'succeed',
    private readonly idempotencyMode: 'provider-enforced' | 'best-effort' | 'none' = 'none',
    private readonly onEffect?: (input: AuthorizedActionExecution) => void | Promise<void>,
  ) {}

  descriptor() {
    return { executorId: 'executor:recording', idempotencyMode: this.idempotencyMode } as const;
  }

  async execute(input: AuthorizedActionExecution): Promise<ActionExecutionResult> {
    this.executeCalls.push(structuredClone(input));
    const providerOperationId = `provider-op:${input.executionId}`;
    const externalRef = `external:${input.authorization.action.action_id}`;

    if (this.mode !== 'fail' && this.mode !== 'unknown') {
      this.appliedEffects.set(input.executionId, { providerOperationId, externalRef });
      await this.onEffect?.(input);
    }

    if (this.mode === 'effect-then-throw') throw new InjectedCrashAfterEffectError();
    if (this.mode === 'fail') return { status: 'failed', errorCode: 'fixture-failure' };
    if (this.mode === 'partial') {
      return { status: 'partial', providerOperationId, externalRef, redactedSummary: 'fixture partial effect' };
    }
    if (this.mode === 'unknown') return { status: 'unknown', errorCode: 'fixture-unknown' };
    return { status: 'succeeded', providerOperationId, externalRef, resultHash: 'sha256:fixture-result' };
  }

  async reconcile(input: ActionReconcileInput): Promise<ActionReconcileResult> {
    this.reconcileCalls.push(structuredClone(input));
    const effect = this.appliedEffects.get(input.executionId);
    if (effect) {
      return {
        status: 'confirmed-succeeded',
        providerOperationId: effect.providerOperationId,
        externalRef: effect.externalRef,
        resultHash: 'sha256:fixture-reconciled',
      };
    }
    return { status: 'still-unknown' };
  }
}
