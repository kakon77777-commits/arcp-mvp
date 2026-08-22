import { contentHash } from '@arcp/schema';
import type { Phase5ModelInvocationRecord, RunRecord } from '@arcp/schema';
import { budgetAvailable } from './budget.js';
import { WorkflowError } from './errors.js';
import {
  buildModelCallEnvelopeItems,
  deriveModelCallLimits,
  modelUsageToEnvelopeActuals,
} from './model-call-budget.js';
import {
  BoundedRunOrchestrator as Phase4BoundedRunOrchestrator,
  deriveRunId,
} from './orchestrator.js';
import type {
  AdvanceBoundedRunInput,
  BoundedRunOrchestratorOptions as Phase4BoundedRunOrchestratorOptions,
} from './orchestrator.js';
import type {
  ActionAuthorityResolverPort,
  ActionExecutorPort,
  CommitPort,
  ContextHydratorPort,
  ModelPort,
  MonotonicClockPort,
  PolicyPort,
  ProvenanceClockPort,
  RunBudgetProviderPort,
  RunStateStorePort,
  WakeAuthorityResolverPort,
} from './ports.js';
import type { Phase5RunStateStorePort } from './phase5-run-state-store.js';
import type { ModelCallLimits, ModelTurnInput, ModelTurnProposal, PreparedModelCall } from './types.js';

export type { AdvanceBoundedRunInput } from './orchestrator.js';

export interface Phase5PreparedModelPort extends ModelPort {
  prepareCall(input: ModelTurnInput, limits: ModelCallLimits): Promise<PreparedModelCall>;
}

export interface Phase5BoundedRunOrchestratorOptions {
  store: Phase5RunStateStorePort;
  hydrator: ContextHydratorPort;
  model: Phase5PreparedModelPort;
  wakeAuthority: WakeAuthorityResolverPort;
  actionAuthority: ActionAuthorityResolverPort;
  policy: PolicyPort;
  budgetProvider: RunBudgetProviderPort;
  executor?: ActionExecutorPort;
  commit?: CommitPort;
  defaultApprovalParties?: string[];
  provenanceClock: ProvenanceClockPort;
  monotonicClock: MonotonicClockPort;
}

/**
 * During the migration PR we continue accepting the explicit Phase 4 options
 * so old Phase 4 regression fixtures exercise the exact old engine. New code
 * with explicit clocks always selects the Phase 5 path below.
 */
export type BoundedRunOrchestratorOptions =
  | Phase5BoundedRunOrchestratorOptions
  | Phase4BoundedRunOrchestratorOptions;

interface ActiveAdvanceBudget {
  envelopeId: string;
  reservedMs: number;
  startMs: number;
  runId: string;
}

function compactHash(prefix: string, value: unknown): string {
  const digest = contentHash(value).slice('sha256:'.length, 'sha256:'.length + 32);
  return `${prefix}${digest}`;
}

function isTerminal(run: RunRecord): boolean {
  return run.phase === 'completed' || run.phase === 'dead-lettered' || run.phase === 'failed';
}

function isHostWorkflowError(error: unknown): error is WorkflowError {
  return error instanceof WorkflowError;
}

/**
 * Phase 5.0A canonical orchestrator. It deliberately reuses the already
 * verified Phase 4 action/approval/reconcile state machine while replacing
 * only its legacy model accounting surface with hard budget envelopes.
 */
export class BoundedRunOrchestrator {
  private readonly legacy?: Phase4BoundedRunOrchestrator;
  private readonly phase5?: Phase5BoundedRunOrchestratorOptions;

  constructor(options: BoundedRunOrchestratorOptions) {
    if ('provenanceClock' in options) this.phase5 = options;
    else this.legacy = new Phase4BoundedRunOrchestrator(options);
  }

  async advance(input: AdvanceBoundedRunInput) {
    if (this.legacy) return this.legacy.advance(input);
    const options = this.phase5!;
    const runId = input.runId ?? deriveRunId(input.agentId, input.wake.idempotency_key);
    let active: ActiveAdvanceBudget | undefined;

    const startAdvanceBudget = async (run: RunRecord): Promise<void> => {
      if (active || isTerminal(run)) return;
      if (run.fencing_token !== input.fencingToken) return;

      const view = await options.store.getBudgetView(run.run_id);
      const available = budgetAvailable(view.wall_time_ms);
      if (!Number.isFinite(available) || available <= 0) {
        throw new WorkflowError('runtime_wall_time_exhausted', 'active wall-time budget exhausted', false);
      }
      const envelopeId = compactHash('arcp:budget-envelope:advance:', {
        run_id: run.run_id,
        wake_idempotency_key: input.wake.idempotency_key,
        fencing_token: run.fencing_token,
      });
      const envelope = await options.store.reserveBudgetEnvelope({
        runId: run.run_id,
        fencingToken: run.fencing_token,
        envelopeId,
        kind: 'advance',
        items: [{ dimension: 'wall_time_ms', amount: available }],
        reservedAt: options.provenanceClock.now(),
      });
      const item = envelope.items.find((candidate) => candidate.dimension === 'wall_time_ms');
      if (!item) throw new WorkflowError('invalid_persisted_state', 'advance envelope lacks wall_time_ms', false);
      active = {
        envelopeId,
        reservedMs: item.reserved,
        startMs: options.monotonicClock.nowMs(),
        runId: run.run_id,
      };
    };

    const storeFacade = new Proxy(options.store as Phase5RunStateStorePort, {
      get(target, property) {
        if (property === 'reserveModelBudget' || property === 'settleModelBudget' || property === 'appendModelInvocation') {
          return async () => undefined;
        }
        if (property === 'getRun') {
          return async (requestedRunId: string) => {
            const run = await target.getRun(requestedRunId);
            if (requestedRunId === runId && run && run.fencing_token === input.fencingToken) {
              await startAdvanceBudget(run);
            }
            return run;
          };
        }
        if (property === 'createRunIfAbsent') {
          return async (candidate: RunRecord) => {
            const run = await target.createRunIfAbsent(candidate);
            if (run.run_id === runId) await startAdvanceBudget(run);
            return run;
          };
        }
        if (property === 'updateRun') {
          return async (candidate: RunRecord, expectedFencingToken?: number) => {
            const run = await target.updateRun(candidate, expectedFencingToken);
            if (run.run_id === runId && run.fencing_token === input.fencingToken) {
              await startAdvanceBudget(run);
            }
            return run;
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as unknown as RunStateStorePort;

    const modelFacade: ModelPort = {
      deliberate: async (legacyInput: ModelTurnInput): Promise<ModelTurnProposal> => {
        const run = await options.store.getRun(legacyInput.runId);
        if (!run) throw new WorkflowError('invalid_persisted_state', `run not found: ${legacyInput.runId}`, false);
        if (!active) await startAdvanceBudget(run);
        if (!active) throw new WorkflowError('invalid_persisted_state', 'advance budget did not start', false);

        const elapsedBeforeCall = options.monotonicClock.nowMs() - active.startMs;
        const remainingWallTimeMs = active.reservedMs - elapsedBeforeCall;
        if (!Number.isFinite(remainingWallTimeMs) || remainingWallTimeMs <= 0) {
          throw new WorkflowError('runtime_wall_time_exhausted', 'no active wall time remains before model call', false);
        }

        const before = await options.store.getBudgetView(run.run_id);
        const envelopeId = compactHash('arcp:budget-envelope:model:', {
          run_id: run.run_id,
          turn_index: legacyInput.turnIndex,
        });
        const envelope = await options.store.reserveBudgetEnvelope({
          runId: run.run_id,
          fencingToken: run.fencing_token,
          envelopeId,
          kind: 'model-call',
          items: buildModelCallEnvelopeItems(before),
          reservedAt: options.provenanceClock.now(),
        });
        const truthfulBudgetView = await options.store.getBudgetView(run.run_id);
        const limits = deriveModelCallLimits(envelope, remainingWallTimeMs);
        const invocationId = compactHash('arcp:model-invocation:', {
          runId: run.run_id,
          turnIndex: legacyInput.turnIndex,
        });
        const reservedInvocation: Phase5ModelInvocationRecord = {
          schema: 'arcp/model-invocation/0.1',
          invocation_id: invocationId,
          run_id: run.run_id,
          turn_index: legacyInput.turnIndex,
          status: 'reserved',
          budget_envelope_id: envelope.envelope_id,
          input_hash: legacyInput.context.contextHash,
          observed_at: options.provenanceClock.now(),
        };
        await options.store.createModelInvocation(reservedInvocation);

        let prepared: PreparedModelCall;
        try {
          prepared = await options.model.prepareCall({
            ...legacyInput,
            budgetView: truthfulBudgetView,
          }, limits);
        } catch (error) {
          await options.store.transitionModelInvocation(invocationId, 'reserved', {
            ...reservedInvocation,
            status: 'failed',
            observed_at: options.provenanceClock.now(),
          });
          await options.store.releaseBudgetEnvelope({
            runId: run.run_id,
            envelopeId: envelope.envelope_id,
            releasedAt: options.provenanceClock.now(),
          });
          throw error;
        }

        const calling: Phase5ModelInvocationRecord = {
          ...reservedInvocation,
          status: 'calling',
          observed_at: options.provenanceClock.now(),
        };
        await options.store.transitionModelInvocation(invocationId, 'reserved', calling);

        let proposal: ModelTurnProposal;
        try {
          proposal = await prepared.execute();
        } catch (error) {
          const ambiguous = error instanceof Error && error.name === 'AmbiguousModelInvocationError';
          await options.store.transitionModelInvocation(invocationId, 'calling', {
            ...calling,
            status: ambiguous ? 'unknown' : 'failed',
            observed_at: options.provenanceClock.now(),
          });
          await options.store.markBudgetEnvelopeRecoveryRequired(run.run_id, envelope.envelope_id);
          throw error;
        }

        try {
          const actuals = modelUsageToEnvelopeActuals(envelope, proposal.usage);
          await options.store.transitionModelInvocation(invocationId, 'calling', {
            ...calling,
            status: 'succeeded',
            output_hash: contentHash(proposal),
            usage: {
              input_tokens: proposal.usage.inputTokens,
              output_tokens: proposal.usage.outputTokens,
              cost_micros: proposal.usage.costMicros,
            },
            observed_at: options.provenanceClock.now(),
          });
          await options.store.settleBudgetEnvelope({
            runId: run.run_id,
            envelopeId: envelope.envelope_id,
            actuals,
            settledAt: options.provenanceClock.now(),
          });
          return proposal;
        } catch (error) {
          const current = await options.store.getModelInvocation(invocationId);
          if (current?.status === 'calling') {
            await options.store.transitionModelInvocation(invocationId, 'calling', {
              ...calling,
              status: 'unknown',
              output_hash: contentHash(proposal),
              usage: {
                ...(proposal.usage.inputTokens === undefined ? {} : { input_tokens: proposal.usage.inputTokens }),
                ...(proposal.usage.outputTokens === undefined ? {} : { output_tokens: proposal.usage.outputTokens }),
                ...(proposal.usage.costMicros === undefined ? {} : { cost_micros: proposal.usage.costMicros }),
              },
              observed_at: options.provenanceClock.now(),
            });
          }
          const currentEnvelope = await options.store.getBudgetEnvelope(envelope.envelope_id);
          if (currentEnvelope?.status === 'reserved') {
            await options.store.markBudgetEnvelopeRecoveryRequired(run.run_id, envelope.envelope_id);
          }
          throw error;
        }
      },
      prepareCall: options.model.prepareCall.bind(options.model),
    };

    const legacy = new Phase4BoundedRunOrchestrator({
      store: storeFacade,
      hydrator: options.hydrator,
      model: modelFacade,
      wakeAuthority: options.wakeAuthority,
      actionAuthority: options.actionAuthority,
      policy: options.policy,
      budgetProvider: options.budgetProvider,
      ...(options.executor === undefined ? {} : { executor: options.executor }),
      ...(options.commit === undefined ? {} : { commit: options.commit }),
      ...(options.defaultApprovalParties === undefined ? {} : { defaultApprovalParties: options.defaultApprovalParties }),
      now: () => options.provenanceClock.now(),
    });

    let result;
    let thrown: unknown;
    try {
      result = await legacy.advance(input);
    } catch (error) {
      if (
        isHostWorkflowError(error)
        && error.code === 'model_temporarily_unavailable'
        && isHostWorkflowError(error.cause)
      ) {
        thrown = error.cause;
      } else {
        thrown = error;
      }
    }

    if (active) {
      const elapsed = options.monotonicClock.nowMs() - active.startMs;
      if (!Number.isFinite(elapsed) || elapsed < 0) {
        thrown ??= new WorkflowError('runtime_wall_time_exhausted', 'monotonic clock moved backwards', false);
      } else if (elapsed > active.reservedMs) {
        await options.store.settleBudgetEnvelope({
          runId: active.runId,
          envelopeId: active.envelopeId,
          actuals: { wall_time_ms: active.reservedMs },
          settledAt: options.provenanceClock.now(),
        });
        thrown = new WorkflowError('runtime_wall_time_exhausted', 'active wall-time envelope overrun', false);
      } else {
        await options.store.settleBudgetEnvelope({
          runId: active.runId,
          envelopeId: active.envelopeId,
          actuals: { wall_time_ms: elapsed },
          settledAt: options.provenanceClock.now(),
        });
      }
    }

    if (thrown !== undefined) throw thrown;
    return result!;
  }
}
