import { contentHash } from '@arcp/schema';
import type {
  ActionIntent,
  ActionReceipt,
  AuthorityResolution,
  InstantRef,
  ModelInvocationRecord,
  PolicyInput,
  PolicyResult,
  RunCheckpoint,
  RunRecord,
  WakeRecord,
} from '@arcp/schema';
import { createApprovalRequest, evaluateApprovalSatisfaction } from './approvals.js';
import { compareRisk, type BudgetDimension } from './budget.js';
import { evaluateContainment } from './containment.js';
import { WorkflowError } from './errors.js';
import { recoverExecutionDecision } from './execution-ledger.js';
import { computeActionHash, computeApprovalBindingHash } from './hashing.js';
import type {
  ActionAuthorityResolverPort,
  ActionExecutorPort,
  CommitPort,
  ContextHydratorPort,
  ModelPort,
  PolicyPort,
  RunBudgetProviderPort,
  RunStateStorePort,
  WakeAuthorityResolverPort,
} from './ports.js';
import { assertRunPhaseTransition } from './state-machine.js';
import type {
  ActionExecutionResult,
  BoundedRunAdvanceResult,
  HydratedRunContext,
} from './types.js';

export interface BoundedRunOrchestratorOptions {
  store: RunStateStorePort;
  hydrator: ContextHydratorPort;
  model: ModelPort;
  wakeAuthority: WakeAuthorityResolverPort;
  actionAuthority: ActionAuthorityResolverPort;
  policy: PolicyPort;
  budgetProvider: RunBudgetProviderPort;
  executor?: ActionExecutorPort;
  commit?: CommitPort;
  defaultApprovalParties?: string[];
  now: () => InstantRef;
}

export interface AdvanceBoundedRunInput {
  agentId: string;
  wake: WakeRecord;
  fencingToken: number;
  /** Resume an existing run from a separately-authorized wake/event. */
  runId?: string;
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
    continuity_precondition:
      action.continuity_impact === 'migration-required' || action.continuity_impact === 'continuity-destructive'
        ? 'separate-governance'
        : 'none',
  };
}

function approvalExpiry(actionHash: string, wake: WakeRecord, authority: AuthorityResolution): InstantRef {
  if (wake.expires_at_instant) return structuredClone(wake.expires_at_instant);
  if (authority.expires_at) return structuredClone(authority.expires_at);
  return {
    instant_id: compactHash('local:unverified:approval-expiry:', { actionHash, wake: wake.idempotency_key }),
    unverified: true,
  };
}

function resultToReceipt(
  runId: string,
  executionId: string,
  action: ActionIntent,
  executorId: string,
  result: ActionExecutionResult,
  observedAt: InstantRef,
  suffix = 'result',
): ActionReceipt {
  return {
    schema: 'arcp/action-receipt/0.1',
    receipt_id: compactHash('arcp:receipt:', { executionId, suffix, status: result.status, result }),
    execution_id: executionId,
    run_id: runId,
    action_id: action.action_id,
    status: result.status,
    executor_id: executorId,
    ...(result.providerOperationId === undefined ? {} : { provider_operation_id: result.providerOperationId }),
    ...(result.externalRef === undefined ? {} : { external_ref: result.externalRef }),
    ...(result.resultHash === undefined ? {} : { result_hash: result.resultHash }),
    ...(result.errorCode === undefined ? {} : { error_code: result.errorCode }),
    ...(result.redactedSummary === undefined ? {} : { redacted_summary: result.redactedSummary }),
    observed_at: structuredClone(observedAt),
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

    const runId = input.runId ?? deriveRunId(input.agentId, input.wake.idempotency_key);
    let existing = await this.options.store.getRun(runId);
    if (input.runId !== undefined && existing === null) {
      throw new WorkflowError('invalid_wake', `resume run not found: ${input.runId}`, false);
    }
    if (existing && (existing.phase === 'completed' || existing.phase === 'dead-lettered' || existing.phase === 'failed')) {
      return { run: existing, stopReason: existing.stop_reason };
    }

    if (existing && existing.fencing_token !== input.fencingToken) {
      if (input.runId === undefined || !['waiting-approval', 'waiting', 'contained'].includes(existing.phase)) {
        throw new WorkflowError('stale_fencing_token', `run ${runId} is owned by fencing token ${existing.fencing_token}`, false);
      }
      existing = await this.options.store.updateRun({
        ...existing,
        fencing_token: input.fencingToken,
        updated_at: this.options.now(),
      }, existing.fencing_token);
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
      throw new WorkflowError('stale_fencing_token', `run ${run.run_id} is owned by fencing token ${run.fencing_token}`, false);
    }

    const context = await this.hydrateRun(run, input);
    run = (await this.options.store.getRun(run.run_id)) ?? run;
    const latestCheckpoint = await this.options.store.getLatestCheckpoint(run.run_id);
    if (input.runId !== undefined && latestCheckpoint?.pending_action) {
      return this.resumePendingAction(run, latestCheckpoint, context, input.wake);
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
        if (!ambiguous) await this.options.store.settleModelBudget(run.run_id, turnReservationId, 1);
        throw new WorkflowError(
          'model_temporarily_unavailable',
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
      // Token/cost usage is only known once the model has already responded,
      // so unlike 'turns' this reserves and settles the actual amount in one
      // step rather than reserving a fixed amount up front. A dimension the
      // model does not report usage for (usage.inputTokens etc. undefined)
      // is left untouched rather than charged zero, so it stays visibly
      // unbudgeted rather than misleadingly "at 0 of limit".
      await this.chargeReportedUsage(run, turnIndex, 'model_input_tokens', proposal.usage.inputTokens);
      await this.chargeReportedUsage(run, turnIndex, 'model_output_tokens', proposal.usage.outputTokens);
      await this.chargeReportedUsage(run, turnIndex, 'model_cost_micros', proposal.usage.costMicros);

      run = await this.options.store.updateRun({
        ...run,
        turn_index: turnIndex + 1,
        updated_at: this.options.now(),
      }, run.fencing_token);

      this.validateProposal(proposal.actionIntents);

      for (let index = 0; index < proposal.actionIntents.length; index += 1) {
        const action = proposal.actionIntents[index]!;
        const actionStopReason = index === proposal.actionIntents.length - 1 ? proposal.stopReason : undefined;
        const outcome = await this.processFreshAction(run, action, context, input.wake, actionStopReason);
        run = outcome.run;
        if (outcome.terminal) return outcome.result!;
        if (outcome.denial) priorDenials.push(outcome.denial);
      }

      if (proposal.stopReason !== undefined) {
        run = await this.transition(run, 'completed', proposal.stopReason);
        return { run, stopReason: proposal.stopReason };
      }
    }

    run = await this.transition(run, 'completed', 'budget-exhausted:max-turns');
    return { run, stopReason: run.stop_reason };
  }

  private async hydrateRun(run: RunRecord, input: AdvanceBoundedRunInput): Promise<HydratedRunContext> {
    if (run.phase === 'accepted') run = await this.transition(run, 'hydrating');
    const context = await this.options.hydrator.hydrate({
      agentId: input.agentId,
      runId: run.run_id,
      wake: input.wake,
    });

    const current = await this.options.store.getRun(run.run_id);
    if (current?.phase === 'hydrating') {
      const deliberating = await this.transition(current, 'deliberating');
      const sequence = deliberating.checkpoint_sequence + 1;
      await this.options.store.saveCheckpoint({
        schema: 'arcp/run-checkpoint/0.1',
        checkpoint_id: compactHash('arcp:checkpoint:', { runId: run.run_id, sequence }),
        run_id: run.run_id,
        sequence,
        phase: deliberating.phase,
        base_manifest_version: context.baseManifestVersion,
        fencing_token: deliberating.fencing_token,
        context_hash: context.contextHash,
        created_at: this.options.now(),
      });
      await this.options.store.updateRun({
        ...deliberating,
        checkpoint_sequence: sequence,
        updated_at: this.options.now(),
      }, deliberating.fencing_token);
    }
    return context;
  }

  private async processFreshAction(
    run: RunRecord,
    action: ActionIntent,
    context: HydratedRunContext,
    wake: WakeRecord,
    stopReason?: string,
  ): Promise<{ run: RunRecord; terminal: boolean; denial?: AuthorityResolution; result?: BoundedRunAdvanceResult }> {
    run = await this.transition(run, 'authorizing');
    const actionHash = computeActionHash(action);
    const authority = await this.resolveAuthority(run, action, actionHash);

    if (authority.status === 'denied') {
      const next = await this.transition(run, 'deliberating');
      return { run: next, terminal: false, denial: authority };
    }

    const policy = this.evaluatePolicy(run, action, false);
    if (policy.decision === 'deny') {
      const denial: AuthorityResolution = { ...authority, status: 'denied' };
      const next = await this.transition(run, 'deliberating');
      return { run: next, terminal: false, denial };
    }

    if (policy.decision === 'request-approval' || policy.decision === 'require-multi-party') {
      const parties = [...new Set(this.options.defaultApprovalParties ?? [])];
      if (parties.length === 0) {
        throw new WorkflowError('approval_invalid', 'approval-required action has no configured approval parties', false);
      }
      const expiresAt = approvalExpiry(actionHash, wake, authority);
      const request = createApprovalRequest({
        runId: run.run_id,
        actionId: action.action_id,
        actionHash,
        authority,
        policyVersion: policy.policy_version,
        requiredParties: parties,
        requestedScope: action.requested_scopes,
        bindingResourceScope: authority.resource_scope,
        createdAt: this.options.now(),
        expiresAt,
      });
      await this.options.store.createApprovalRequest(request);
      run = await this.savePendingCheckpoint(run, context, action, actionHash, authority, stopReason, request.approval_request_id);
      run = await this.transition(run, 'waiting-approval', 'approval-required');
      return {
        run,
        terminal: true,
        result: { run, stopReason: run.stop_reason, pendingApprovalRequestId: request.approval_request_id },
      };
    }

    if (policy.decision === 'delay') {
      run = await this.savePendingCheckpoint(run, context, action, actionHash, authority, stopReason);
      run = await this.transition(run, 'waiting', 'policy-delay');
      return { run, terminal: true, result: { run, stopReason: run.stop_reason } };
    }

    run = await this.savePendingCheckpoint(run, context, action, actionHash, authority, stopReason);
    const result = await this.executeAuthorizedAction(run, action, actionHash, authority, policy, context, wake, stopReason);
    return { run: result.run, terminal: result.run.phase !== 'deliberating', result: result.run.phase !== 'deliberating' ? result : undefined };
  }

  private async resumePendingAction(
    run: RunRecord,
    checkpoint: RunCheckpoint,
    context: HydratedRunContext,
    wake: WakeRecord,
  ): Promise<BoundedRunAdvanceResult> {
    const action = checkpoint.pending_action;
    const actionHash = checkpoint.pending_action_hash;
    if (!action || !actionHash) {
      throw new WorkflowError('invalid_persisted_state', `run ${run.run_id} has no resumable pending action`, false);
    }

    let approvalValid = false;
    if (run.phase === 'waiting-approval') {
      const requestId = checkpoint.pending_approval_request_id;
      if (!requestId) throw new WorkflowError('invalid_persisted_state', 'waiting-approval checkpoint lacks request id', false);
      const request = await this.options.store.getApprovalRequest(requestId);
      if (!request) throw new WorkflowError('approval_invalid', `approval request not found: ${requestId}`, false);
      const grants = await this.options.store.getApprovalGrants(requestId);
      const satisfaction = evaluateApprovalSatisfaction(request, grants, this.options.now());
      if (!satisfaction.satisfied) {
        return { run, stopReason: run.stop_reason, pendingApprovalRequestId: requestId };
      }

      run = await this.transition(run, 'authorizing');
      const authority = await this.resolveAuthority(run, action, actionHash);
      const authorityHash = contentHash(authority);
      const bindingHash = computeApprovalBindingHash({
        actionHash,
        authorityResolutionHash: authorityHash,
        policyVersion: request.policy_version,
        resourceScope: authority.resource_scope,
        expiresAt: request.expires_at,
        requiredParties: request.required_parties,
      });
      if (authorityHash !== request.authority_resolution_hash || bindingHash !== request.binding_hash) {
        throw new WorkflowError('approval_invalid', 'approval no longer binds to the current authority/action scope', false);
      }
      const policy = this.evaluatePolicy(run, action, true);
      if (policy.decision !== 'allow' && policy.decision !== 'allow-with-log') {
        throw new WorkflowError('approval_invalid', `approved action no longer passes current policy: ${policy.decision}`, false);
      }
      approvalValid = true;
      return this.executeAuthorizedAction(
        run, action, actionHash, authority, policy, context, wake, checkpoint.pending_model_stop_reason,
      );
    }

    // 'waiting' and 'contained' are pre-execution pauses -- nothing has been
    // claimed/executed yet, so a full re-authorization (mirroring
    // processFreshAction's branch set) is safe and required: policy can
    // legitimately re-evaluate to request-approval/require-multi-party once
    // resumed (e.g. the risk window changed), and executing anyway would
    // bypass approval entirely -- exactly what AREC's binding boundaries
    // ("approval != permanent subordination", trigger != authority) exist to
    // prevent. 'executing'/'reconciling'/'committing' resumes are mid-flight
    // crash recovery for an action already underway or already effected;
    // re-routing those to a fresh approval/delay wait would misrepresent an
    // in-progress or completed effect as not-yet-decided, so they keep the
    // narrower authority/policy sanity check only and hand off directly to
    // executeAuthorizedAction, which owns its own phase transitions.
    if (run.phase === 'waiting' || run.phase === 'contained') {
      run = await this.transition(run, 'authorizing');
      const authority = await this.resolveAuthority(run, action, actionHash);
      if (authority.status === 'denied') {
        throw new WorkflowError('action_authority_denied', 'pending action no longer has authority', false);
      }

      const policy = this.evaluatePolicy(run, action, approvalValid);
      if (policy.decision === 'deny') {
        throw new WorkflowError('action_authority_denied', 'pending action no longer passes policy', false);
      }

      if (policy.decision === 'request-approval' || policy.decision === 'require-multi-party') {
        const parties = [...new Set(this.options.defaultApprovalParties ?? [])];
        if (parties.length === 0) {
          throw new WorkflowError('approval_invalid', 'approval-required action has no configured approval parties', false);
        }
        const expiresAt = approvalExpiry(actionHash, wake, authority);
        const request = createApprovalRequest({
          runId: run.run_id,
          actionId: action.action_id,
          actionHash,
          authority,
          policyVersion: policy.policy_version,
          requiredParties: parties,
          requestedScope: action.requested_scopes,
          bindingResourceScope: authority.resource_scope,
          createdAt: this.options.now(),
          expiresAt,
        });
        await this.options.store.createApprovalRequest(request);
        run = await this.savePendingCheckpoint(
          run, context, action, actionHash, authority, checkpoint.pending_model_stop_reason, request.approval_request_id,
        );
        run = await this.transition(run, 'waiting-approval', 'approval-required');
        return {
          run,
          stopReason: run.stop_reason,
          pendingApprovalRequestId: request.approval_request_id,
        };
      }

      if (policy.decision === 'delay') {
        run = await this.savePendingCheckpoint(run, context, action, actionHash, authority, checkpoint.pending_model_stop_reason);
        run = await this.transition(run, 'waiting', 'policy-delay');
        return { run, stopReason: run.stop_reason };
      }

      return this.executeAuthorizedAction(
        run, action, actionHash, authority, policy, context, wake, checkpoint.pending_model_stop_reason,
      );
    }

    const authority = await this.resolveAuthority(run, action, actionHash);
    const policy = this.evaluatePolicy(run, action, approvalValid);
    if (authority.status === 'denied' || policy.decision === 'deny') {
      throw new WorkflowError('action_authority_denied', 'pending action no longer has authority', false);
    }
    return this.executeAuthorizedAction(
      run, action, actionHash, authority, policy, context, wake, checkpoint.pending_model_stop_reason,
    );
  }

  private async executeAuthorizedAction(
    run: RunRecord,
    action: ActionIntent,
    actionHash: string,
    authority: AuthorityResolution,
    policy: PolicyResult,
    context: HydratedRunContext,
    wake: WakeRecord,
    stopReason?: string,
  ): Promise<BoundedRunAdvanceResult> {
    const executor = this.options.executor;
    const commit = this.options.commit;
    if (!executor || !commit) {
      throw new WorkflowError('execution_failed', `authorized action ${action.action_id} has no Phase 4 executor/commit port`, false);
    }

    const descriptor = executor.descriptor();
    const executionId = compactHash('arcp:execution:', { runId: run.run_id, actionHash });
    const providerIdempotencyKey = descriptor.idempotencyMode === 'provider-enforced'
      ? action.idempotency_key
      : undefined;
    let execution = await this.options.store.getActionExecution(executionId);

    // Containment restricts channels for NEW external effects; it must not
    // block recording/committing evidence of an effect that already
    // happened (AREC: "an already-performed effect's receipt/audit evidence
    // remains recordable" -- suspend != identity/evidence rewrite). Compute
    // recovery for any already-claimed execution BEFORE the containment
    // gate, so a run stuck between "receipt recorded" and "canonically
    // committed" can still finish while contained.
    const priorRecovery = execution ? recoverExecutionDecision(execution) : null;
    if (priorRecovery !== 'commit-only' && priorRecovery !== 'done') {
      const containments = await this.options.store.activeContainments(run.agent_id);
      const blocked = action.requested_scopes.some((scope) =>
        evaluateContainment(containments, `external-action:${scope}`).blocked,
      );
      if (blocked) {
        if (run.phase !== 'contained') run = await this.transition(run, 'contained', 'containment-active');
        return { run, stopReason: run.stop_reason };
      }
    }

    if (!execution) {
      execution = await this.options.store.reserveBudgetAndClaimAction({
        runId: run.run_id,
        fencingToken: run.fencing_token,
        executionId,
        actionId: action.action_id,
        actionHash,
        actionIdempotencyKey: action.idempotency_key,
        executorId: descriptor.executorId,
        providerIdempotencyMode: descriptor.idempotencyMode,
        ...(providerIdempotencyKey === undefined ? {} : { providerIdempotencyKey }),
        reservationId: `budget:external-action:${executionId}`,
        budgetDimension: 'external_actions',
        budgetAmount: 1,
        claimedAt: this.options.now(),
      });
    }

    const recovery = priorRecovery ?? recoverExecutionDecision(execution);
    if (recovery === 'done') {
      return this.finishAfterCanonicalAction(run, stopReason);
    }
    if (recovery === 'commit-only') {
      return this.commitRecordedEffect(run, execution.execution_id, authority, policy, context, wake, stopReason);
    }
    if (recovery === 'reconcile' || recovery === 'safe-provider-retry-or-reconcile') {
      if (run.phase === 'executing') run = await this.transition(run, 'reconciling');
      else if (run.phase !== 'reconciling') {
        throw new WorkflowError('invalid_persisted_state', `cannot reconcile execution from run phase ${run.phase}`, false);
      }
      const reconciled = await executor.reconcile({
        runId: run.run_id,
        executionId,
        action,
        ...(providerIdempotencyKey === undefined ? {} : { providerIdempotencyKey }),
      });
      if (reconciled.status === 'still-unknown') {
        const receipt = resultToReceipt(run.run_id, executionId, action, descriptor.executorId, {
          status: 'unknown',
          errorCode: reconciled.errorCode ?? 'reconciliation-still-unknown',
          redactedSummary: reconciled.redactedSummary,
        }, this.options.now(), 'reconcile-unknown');
        await this.options.store.appendActionReceipt(receipt);
        await this.options.store.markActionReconciled(executionId, 'unknown');
        await this.options.store.appendDeadLetter({
          schema: 'arcp/dead-letter/0.1',
          dead_letter_id: compactHash('arcp:dead-letter:', { executionId, kind: 'unknown-effect' }),
          run_id: run.run_id,
          action_id: action.action_id,
          stage: 'reconciliation',
          attempts: execution.attempt,
          last_error_code: 'execution_unknown',
          effect_state: 'unknown',
          manual_resolution_required: true,
          created_at: this.options.now(),
        });
        run = await this.transition(run, 'dead-lettered', 'execution-effect-unknown');
        return { run, stopReason: run.stop_reason };
      }
      const status = reconciled.status === 'confirmed-succeeded'
        ? 'succeeded'
        : reconciled.status === 'confirmed-failed'
          ? 'failed'
          : 'partial';
      const receipt = resultToReceipt(run.run_id, executionId, action, descriptor.executorId, {
        status,
        providerOperationId: reconciled.providerOperationId,
        externalRef: reconciled.externalRef,
        resultHash: reconciled.resultHash,
        errorCode: reconciled.errorCode,
        redactedSummary: reconciled.redactedSummary,
      }, this.options.now(), 'reconciled');
      await this.options.store.appendActionReceipt(receipt);
      await this.options.store.markActionReconciled(executionId, status);
      return this.commitRecordedEffect(run, executionId, authority, policy, context, wake, stopReason);
    }

    if (run.phase === 'authorizing') run = await this.transition(run, 'executing');
    else if (run.phase !== 'executing') {
      throw new WorkflowError('invalid_persisted_state', `cannot execute action from run phase ${run.phase}`, false);
    }
    execution = await this.options.store.markActionExecuting(executionId, run.fencing_token, this.options.now());

    // Deliberately do not catch executor exceptions here. If a process/provider
    // fails after the durable `executing` boundary, the unchanged execution
    // record is the recovery signal. The next advance reconciles instead of
    // blindly calling execute again.
    const result = await executor.execute({
      runId: run.run_id,
      executionId,
      authorization: {
        action,
        actionHash,
        authority,
        policy,
        grantedScope: [...authority.resource_scope],
      },
      ...(providerIdempotencyKey === undefined ? {} : { providerIdempotencyKey }),
    });

    if (result.status === 'unknown') {
      run = await this.transition(run, 'reconciling');
      const reconciled = await executor.reconcile({
        runId: run.run_id,
        executionId,
        action,
        providerOperationId: result.providerOperationId,
        ...(providerIdempotencyKey === undefined ? {} : { providerIdempotencyKey }),
      });
      if (reconciled.status === 'still-unknown') {
        const unknownReceipt = resultToReceipt(run.run_id, executionId, action, descriptor.executorId, result, this.options.now());
        await this.options.store.appendActionReceipt(unknownReceipt);
        await this.options.store.markActionReconciled(executionId, 'unknown');
        await this.options.store.appendDeadLetter({
          schema: 'arcp/dead-letter/0.1',
          dead_letter_id: compactHash('arcp:dead-letter:', { executionId, kind: 'unknown-effect' }),
          run_id: run.run_id,
          action_id: action.action_id,
          stage: 'reconciliation',
          attempts: execution.attempt,
          last_error_code: 'execution_unknown',
          effect_state: 'unknown',
          manual_resolution_required: true,
          created_at: this.options.now(),
        });
        run = await this.transition(run, 'dead-lettered', 'execution-effect-unknown');
        return { run, stopReason: run.stop_reason };
      }
      const status = reconciled.status === 'confirmed-succeeded'
        ? 'succeeded'
        : reconciled.status === 'confirmed-failed'
          ? 'failed'
          : 'partial';
      const reconciledReceipt = resultToReceipt(run.run_id, executionId, action, descriptor.executorId, {
        status,
        providerOperationId: reconciled.providerOperationId,
        externalRef: reconciled.externalRef,
        resultHash: reconciled.resultHash,
        errorCode: reconciled.errorCode,
        redactedSummary: reconciled.redactedSummary,
      }, this.options.now(), 'reconciled');
      await this.options.store.appendActionReceipt(reconciledReceipt);
      await this.options.store.markActionReconciled(executionId, status);
      return this.commitRecordedEffect(run, executionId, authority, policy, context, wake, stopReason);
    }

    const receipt = resultToReceipt(run.run_id, executionId, action, descriptor.executorId, result, this.options.now());
    await this.options.store.appendActionReceipt(receipt);
    return this.commitRecordedEffect(run, executionId, authority, policy, context, wake, stopReason);
  }

  private async commitRecordedEffect(
    run: RunRecord,
    executionId: string,
    authority: AuthorityResolution,
    policy: PolicyResult,
    context: HydratedRunContext,
    wake: WakeRecord,
    stopReason?: string,
  ): Promise<BoundedRunAdvanceResult> {
    const commit = this.options.commit;
    if (!commit) throw new WorkflowError('commit_failed', 'no canonical CommitPort configured', false);
    if (run.phase !== 'committing') run = await this.transition(run, 'committing');
    const receipts = await this.options.store.getActionReceipts(run.run_id);
    const authorities = await this.options.store.getAuthorityResolutions(run.run_id);
    const manifest = await commit.commit({
      run,
      wake,
      receipts,
      authorityResolutions: authorities.length > 0 ? authorities : [authority],
      policyResults: [policy],
      expectedBaseManifestVersion: context.baseManifestVersion,
      fencingToken: run.fencing_token,
    });
    await this.options.store.markActionCanonicallyRecorded(executionId);
    const finished = await this.finishAfterCanonicalAction(run, stopReason);
    return { ...finished, manifest };
  }

  private async finishAfterCanonicalAction(run: RunRecord, stopReason?: string): Promise<BoundedRunAdvanceResult> {
    if (run.phase !== 'committing') {
      if (run.phase === 'executing' || run.phase === 'reconciling') run = await this.transition(run, 'committing');
      else if (run.phase !== 'completed') {
        throw new WorkflowError('invalid_persisted_state', `cannot finish canonical action from phase ${run.phase}`, false);
      }
    }
    if (run.phase === 'completed') return { run, stopReason: run.stop_reason };
    if (stopReason !== undefined) {
      run = await this.transition(run, 'completed', stopReason);
      return { run, stopReason };
    }
    run = await this.transition(run, 'deliberating');
    return { run };
  }

  private async chargeReportedUsage(
    run: RunRecord,
    turnIndex: number,
    dimension: BudgetDimension,
    amount: number | undefined,
  ): Promise<void> {
    if (amount === undefined || amount <= 0) return;
    const reservationId = `budget:${dimension}:${run.run_id}:${turnIndex}`;
    await this.options.store.reserveModelBudget(run.run_id, run.fencing_token, {
      reservationId, dimension, amount,
    });
    await this.options.store.settleModelBudget(run.run_id, reservationId, amount);
  }

  private async resolveAuthority(run: RunRecord, action: ActionIntent, actionHash: string): Promise<AuthorityResolution> {
    const authority = compareRisk(action.risk, run.budget_spec.max_risk) > 0
      ? deniedForRisk(run.run_id, action, actionHash)
      : await this.options.actionAuthority.resolveAction({ runId: run.run_id, action, actionHash });
    await this.options.store.appendAuthorityResolution(authority);
    return authority;
  }

  private evaluatePolicy(run: RunRecord, action: ActionIntent, hasValidApproval: boolean): PolicyResult {
    const input: PolicyInput = {
      actor: action.actor,
      intent: action.intent,
      target: action.target,
      sensitivity: action.sensitivity,
      risk: action.risk,
      reversibility: action.reversibility,
      requested_scopes: action.requested_scopes,
      lease_fencing_token: run.fencing_token,
      budget: { remaining: run.budget_spec.max_external_actions, unit: 'external-actions' },
      // Hardcoded: no component in this codebase currently produces a
      // version != 1, so ApprovalRequest.policy_version binding (see
      // resumePendingAction) cannot yet detect a real policy-version change
      // between approval-creation and consumption. Real policy versioning is
      // a separate, not-yet-built capability -- known limitation, not an
      // oversight to silently paper over here.
      policy_version: 1,
    };
    return this.options.policy.evaluate(input, { hasValidApproval });
  }

  private async savePendingCheckpoint(
    run: RunRecord,
    context: HydratedRunContext,
    action: ActionIntent,
    actionHash: string,
    authority: AuthorityResolution,
    stopReason?: string,
    approvalRequestId?: string,
  ): Promise<RunRecord> {
    const sequence = run.checkpoint_sequence + 1;
    await this.options.store.saveCheckpoint({
      schema: 'arcp/run-checkpoint/0.1',
      checkpoint_id: compactHash('arcp:checkpoint:', { runId: run.run_id, sequence, actionHash }),
      run_id: run.run_id,
      sequence,
      phase: run.phase,
      base_manifest_version: context.baseManifestVersion,
      fencing_token: run.fencing_token,
      context_hash: context.contextHash,
      pending_action_id: action.action_id,
      pending_action: structuredClone(action),
      pending_action_hash: actionHash,
      pending_authority_resolution_id: authority.resolution_id,
      ...(approvalRequestId === undefined ? {} : { pending_approval_request_id: approvalRequestId }),
      ...(stopReason === undefined ? {} : { pending_model_stop_reason: stopReason }),
      created_at: this.options.now(),
    });
    return this.options.store.updateRun({
      ...run,
      checkpoint_sequence: sequence,
      updated_at: this.options.now(),
    }, run.fencing_token);
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
