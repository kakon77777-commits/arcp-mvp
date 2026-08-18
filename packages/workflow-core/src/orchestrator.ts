import { contentHash } from '@arcp/schema';
import type {
  ActionIntent,
  AuthorityResolution,
  InstantRef,
  ModelInvocationRecord,
  PolicyInput,
  RunRecord,
  WakeRecord,
} from '@arcp/schema';
import { compareRisk } from './budget.js';
import { WorkflowError } from './errors.js';
import { computeActionHash } from './hashing.js';
import type {
  ActionAuthorityResolverPort,
  ContextHydratorPort,
  ModelPort,
  PolicyPort,
  RunBudgetProviderPort,
  RunStateStorePort,
  WakeAuthorityResolverPort,
} from './ports.js';
import { assertRunPhaseTransition } from './state-machine.js';
import type { BoundedRunAdvanceResult } from './types.js';

export interface BoundedRunOrchestratorOptions {
  store: RunStateStorePort;
  hydrator: ContextHydratorPort;
  model: ModelPort;
  wakeAuthority: WakeAuthorityResolverPort;
  actionAuthority: ActionAuthorityResolverPort;
  policy: PolicyPort;
  budgetProvider: RunBudgetProviderPort;
  now: () => InstantRef;
}

export interface AdvanceBoundedRunInput {
  agentId: string;
  wake: WakeRecord;
  fencingToken: number;
}

function compactHash(prefix: string, value: unknown): string {
  const digest = contentHash(value).slice('sha256:'.length, 'sha256:'.length + 32);
  return `${prefix}${digest}`;
}

export function deriveRunId(agentId: string, wakeIdempotencyKey: string): string {
  return compactHash('arcp:run:', {
    schema: 'arcp/run-id-binding/0.1',
    agent_id: agentId,
    wake_idempotency_key: wakeIdempotencyKey,
  });
}

function deniedForRisk(runId: string, action: ActionIntent, actionHash: string): AuthorityResolution {
  return {
    schema: 'arcp/authority-resolution/0.1',
    resolution_id: compactHash('arcp:authority:', { runId, actionHash, reason: 'run-max-risk' }),
    run_id: runId,
    action_id: action.action_id,
    action_hash: actionHash,
    status: 'denied',
    sources: [],
    subject_entity_ref: action.subject_entity_ref ?? action.actor,
    resource_scope: [],
    relation_refs: [...(action.relation_refs ?? [])],
    contract_refs: [...(action.contract_refs ?? [])],
    revocable: true,
    continuity_precondition: action.continuity_impact === 'migration-required' || action.continuity_impact === 'continuity-destructive'
      ? 'separate-governance'
      : 'none',
  };
}

export class BoundedRunOrchestrator {
  private readonly options: BoundedRunOrchestratorOptions;

  constructor(options: BoundedRunOrchestratorOptions) {
    this.options = options;
  }

  async advance(input: AdvanceBoundedRunInput): Promise<BoundedRunAdvanceResult> {
    const wakeAuthority = await this.options.wakeAuthority.resolveWake({
      agentId: input.agentId,
      wake: input.wake,
    });
    if (!wakeAuthority.authorized) {
      throw new WorkflowError('wake_authority_denied', wakeAuthority.reason, false);
    }

    const runId = deriveRunId(input.agentId, input.wake.idempotency_key);
    const existing = await this.options.store.getRun(runId);
    if (existing && (existing.phase === 'completed' || existing.phase === 'dead-lettered' || existing.phase === 'failed')) {
      return { run: existing, stopReason: existing.stop_reason };
    }

    const budget = existing?.budget_spec ?? await this.options.budgetProvider.resolveBudget(
      input.agentId,
      input.wake.budget_ref,
    );
    const createdAt = this.options.now();
    let run = existing ?? await this.options.store.createRunIfAbsent({
      schema: 'arcp/run/0.1',
      run_id: runId,
      agent_id: input.agentId,
      wake_id: input.wake.wake_id,
      wake_idempotency_key: input.wake.idempotency_key,
      phase: 'accepted',
      fencing_token: input.fencingToken,
      ...(input.wake.budget_ref === undefined ? {} : { budget_ref: input.wake.budget_ref }),
      budget_spec: structuredClone(budget),
      turn_index: 0,
      checkpoint_sequence: 0,
      created_at: structuredClone(createdAt),
      updated_at: structuredClone(createdAt),
    });

    if (run.fencing_token !== input.fencingToken) {
      // Resume/fresh-host integration will explicitly rotate this token. Until
      // then, never let a caller advance a run using a token it does not own.
      throw new WorkflowError('stale_fencing_token', `run ${run.run_id} is owned by fencing token ${run.fencing_token}`, false);
    }

    if (run.phase === 'accepted') run = await this.transition(run, 'hydrating');
    const context = await this.options.hydrator.hydrate({
      agentId: input.agentId,
      runId: run.run_id,
      wake: input.wake,
    });

    if (run.phase === 'hydrating') {
      run = await this.transition(run, 'deliberating');
      const checkpointSequence = run.checkpoint_sequence + 1;
      await this.options.store.saveCheckpoint({
        schema: 'arcp/run-checkpoint/0.1',
        checkpoint_id: compactHash('arcp:checkpoint:', { runId: run.run_id, checkpointSequence }),
        run_id: run.run_id,
        sequence: checkpointSequence,
        phase: run.phase,
        base_manifest_version: context.baseManifestVersion,
        fencing_token: run.fencing_token,
        context_hash: context.contextHash,
        created_at: this.options.now(),
      });
      run = await this.options.store.updateRun({
        ...run,
        checkpoint_sequence: checkpointSequence,
        updated_at: this.options.now(),
      }, run.fencing_token);
    }

    const priorDenials = (await this.options.store.getAuthorityResolutions(run.run_id))
      .filter((resolution) => resolution.status === 'denied');
    const priorReceipts = await this.options.store.getActionReceipts(run.run_id);

    while (run.turn_index < run.budget_spec.max_turns) {
      if (run.phase !== 'deliberating') {
        throw new WorkflowError('invalid_persisted_state', `cannot deliberate from run phase ${run.phase}`, false);
      }

      const turnIndex = run.turn_index;
      const turnReservationId = `budget:model-turn:${run.run_id}:${turnIndex}`;
      await this.options.store.reserveModelBudget(run.run_id, run.fencing_token, {
        reservationId: turnReservationId,
        dimension: 'turns',
        amount: 1,
      });

      const invocationId = compactHash('arcp:model-invocation:', { runId: run.run_id, turnIndex });
      let proposal;
      try {
        proposal = await this.options.model.deliberate({
          agentId: input.agentId,
          runId: run.run_id,
          turnIndex,
          wake: input.wake,
          context,
          priorReceipts,
          priorDenials,
          budgetView: {},
        });
      } catch (error) {
        const ambiguous = error instanceof Error && error.name === 'AmbiguousModelInvocationError';
        const invocation: ModelInvocationRecord = {
          schema: 'arcp/model-invocation/0.1',
          invocation_id: invocationId,
          run_id: run.run_id,
          turn_index: turnIndex,
          status: ambiguous ? 'unknown' : 'failed',
          budget_reservation_id: turnReservationId,
          input_hash: context.contextHash,
          observed_at: this.options.now(),
        };
        await this.options.store.appendModelInvocation(invocation);
        if (!ambiguous) {
          await this.options.store.settleModelBudget(run.run_id, turnReservationId, 1);
        }
        throw new WorkflowError(
          ambiguous ? 'model_temporarily_unavailable' : 'model_temporarily_unavailable',
          error instanceof Error ? error.message : 'model invocation failed',
          !ambiguous,
          error instanceof Error ? { cause: error } : undefined,
        );
      }

      await this.options.store.appendModelInvocation({
        schema: 'arcp/model-invocation/0.1',
        invocation_id: invocationId,
        run_id: run.run_id,
        turn_index: turnIndex,
        status: 'succeeded',
        budget_reservation_id: turnReservationId,
        input_hash: context.contextHash,
        output_hash: contentHash(proposal),
        usage: {
          ...(proposal.usage.inputTokens === undefined ? {} : { input_tokens: proposal.usage.inputTokens }),
          ...(proposal.usage.outputTokens === undefined ? {} : { output_tokens: proposal.usage.outputTokens }),
          ...(proposal.usage.costMicros === undefined ? {} : { cost_micros: proposal.usage.costMicros }),
        },
        observed_at: this.options.now(),
      });
      await this.options.store.settleModelBudget(run.run_id, turnReservationId, 1);

      run = await this.options.store.updateRun({
        ...run,
        turn_index: turnIndex + 1,
        updated_at: this.options.now(),
      }, run.fencing_token);

      this.validateProposal(proposal.actionIntents);

      for (const action of proposal.actionIntents) {
        run = await this.transition(run, 'authorizing');
        const actionHash = computeActionHash(action);
        const authority = compareRisk(action.risk, run.budget_spec.max_risk) > 0
          ? deniedForRisk(run.run_id, action, actionHash)
          : await this.options.actionAuthority.resolveAction({
              runId: run.run_id,
              action,
              actionHash,
            });
        await this.options.store.appendAuthorityResolution(authority);

        if (authority.status === 'denied') {
          priorDenials.push(authority);
          run = await this.transition(run, 'deliberating');
          continue;
        }

        const policyInput: PolicyInput = {
          actor: action.actor,
          intent: action.intent,
          target: action.target,
          sensitivity: action.sensitivity,
          risk: action.risk,
          reversibility: action.reversibility,
          requested_scopes: action.requested_scopes,
          lease_fencing_token: run.fencing_token,
          budget: { remaining: run.budget_spec.max_external_actions, unit: 'external-actions' },
          policy_version: 1,
        };
        const policy = this.options.policy.evaluate(policyInput);

        if (policy.decision === 'deny') {
          priorDenials.push({ ...authority, status: 'denied' });
          run = await this.transition(run, 'deliberating');
          continue;
        }
        if (policy.decision === 'request-approval' || policy.decision === 'require-multi-party') {
          run = await this.transition(run, 'waiting-approval', 'approval-required');
          return { run, stopReason: run.stop_reason };
        }
        if (policy.decision === 'delay') {
          run = await this.transition(run, 'waiting', 'policy-delay');
          return { run, stopReason: run.stop_reason };
        }

        // 4B intentionally stops at the external-effect boundary. 4C injects
        // ActionExecutorPort and turns this authorized plan into a durable claim.
        throw new WorkflowError(
          'execution_failed',
          `authorized action ${action.action_id} reached the Phase 4B execution boundary`,
          false,
        );
      }

      if (proposal.stopReason !== undefined) {
        run = await this.transition(run, 'completed', proposal.stopReason);
        return { run, stopReason: proposal.stopReason };
      }
    }

    run = await this.transition(run, 'completed', 'budget-exhausted:max-turns');
    return { run, stopReason: run.stop_reason };
  }

  private async transition(run: RunRecord, phase: RunRecord['phase'], stopReason?: string): Promise<RunRecord> {
    assertRunPhaseTransition(run.phase, phase);
    return this.options.store.updateRun({
      ...run,
      phase,
      ...(stopReason === undefined ? {} : { stop_reason: stopReason }),
      updated_at: this.options.now(),
    }, run.fencing_token);
  }

  private validateProposal(actions: ActionIntent[]): void {
    const ids = new Set<string>();
    const idempotencyKeys = new Set<string>();
    for (const action of actions) {
      if (ids.has(action.action_id)) {
        throw new WorkflowError('model_invalid_output', `duplicate action_id: ${action.action_id}`, false);
      }
      if (idempotencyKeys.has(action.idempotency_key)) {
        throw new WorkflowError('model_invalid_output', `duplicate action idempotency key: ${action.idempotency_key}`, false);
      }
      ids.add(action.action_id);
      idempotencyKeys.add(action.idempotency_key);
    }
  }
}
