import type {
  ActionExecutionRecord,
  ActionReceipt,
  ApprovalGrant,
  ApprovalRequest,
  AuthorityResolution,
  ContainmentRecord,
  DeadLetterRecord,
  ModelInvocationRecord,
  RunCheckpoint,
  RunRecord,
} from '@arcp/schema';
import { InMemoryBudgetLedger } from './budget.js';
import { WorkflowError } from './errors.js';
import type { ActionClaimInput, BudgetReservationInput, RunStateStorePort } from './ports.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryRunStateStore implements RunStateStorePort {
  private readonly runs = new Map<string, RunRecord>();
  private readonly runByWakeKey = new Map<string, string>();
  private readonly checkpoints = new Map<string, RunCheckpoint[]>();
  private readonly budgets = new Map<string, InMemoryBudgetLedger>();
  private readonly modelInvocations = new Map<string, ModelInvocationRecord>();
  private readonly executions = new Map<string, ActionExecutionRecord>();
  private readonly executionByRunActionKey = new Map<string, string>();
  private readonly receipts = new Map<string, ActionReceipt>();
  private readonly authorities = new Map<string, AuthorityResolution[]>();
  private readonly approvalRequests = new Map<string, ApprovalRequest>();
  private readonly approvalGrants = new Map<string, ApprovalGrant[]>();
  private readonly containments = new Map<string, ContainmentRecord>();
  private readonly deadLetters = new Map<string, DeadLetterRecord[]>();

  async createRunIfAbsent(run: RunRecord): Promise<RunRecord> {
    const wakeKey = `${run.agent_id}\u0000${run.wake_idempotency_key}`;
    const existingRunId = this.runByWakeKey.get(wakeKey);
    if (existingRunId !== undefined) {
      const existing = this.runs.get(existingRunId)!;
      return clone(existing);
    }
    if (this.runs.has(run.run_id)) {
      const existing = this.runs.get(run.run_id)!;
      if (existing.agent_id !== run.agent_id || existing.wake_idempotency_key !== run.wake_idempotency_key) {
        throw new WorkflowError('invalid_persisted_state', `run id collision: ${run.run_id}`);
      }
      return clone(existing);
    }
    this.runs.set(run.run_id, clone(run));
    this.runByWakeKey.set(wakeKey, run.run_id);
    this.budgets.set(run.run_id, new InMemoryBudgetLedger(clone(run.budget_spec)));
    return clone(run);
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const run = this.runs.get(runId);
    return run === undefined ? null : clone(run);
  }

  async updateRun(run: RunRecord, expectedFencingToken?: number): Promise<RunRecord> {
    const current = this.runs.get(run.run_id);
    if (current === undefined) throw new WorkflowError('invalid_persisted_state', `run not found: ${run.run_id}`);
    if (expectedFencingToken !== undefined && current.fencing_token !== expectedFencingToken) {
      throw new WorkflowError('stale_fencing_token', `stale run fencing token for ${run.run_id}`);
    }
    this.runs.set(run.run_id, clone(run));
    return clone(run);
  }

  async saveCheckpoint(checkpoint: RunCheckpoint): Promise<void> {
    const items = this.checkpoints.get(checkpoint.run_id) ?? [];
    const existing = items.find((item) => item.checkpoint_id === checkpoint.checkpoint_id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(checkpoint)) {
        throw new WorkflowError('invalid_persisted_state', `checkpoint id collision: ${checkpoint.checkpoint_id}`);
      }
      return;
    }
    items.push(clone(checkpoint));
    items.sort((a, b) => a.sequence - b.sequence);
    this.checkpoints.set(checkpoint.run_id, items);
  }

  async getLatestCheckpoint(runId: string): Promise<RunCheckpoint | null> {
    const items = this.checkpoints.get(runId) ?? [];
    const latest = items.at(-1);
    return latest === undefined ? null : clone(latest);
  }

  async reserveModelBudget(runId: string, fencingToken: number, reservation: BudgetReservationInput): Promise<void> {
    this.assertFencing(runId, fencingToken);
    this.budget(runId).reserve(reservation);
  }

  async settleModelBudget(runId: string, reservationId: string, actualAmount: number): Promise<void> {
    this.budget(runId).settle(reservationId, actualAmount);
  }

  async appendModelInvocation(record: ModelInvocationRecord): Promise<void> {
    const existing = this.modelInvocations.get(record.invocation_id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(record)) {
      throw new WorkflowError('invalid_persisted_state', `model invocation id collision: ${record.invocation_id}`);
    }
    this.modelInvocations.set(record.invocation_id, clone(record));
  }

  async reserveBudgetAndClaimAction(input: ActionClaimInput): Promise<ActionExecutionRecord> {
    this.assertFencing(input.runId, input.fencingToken);
    const actionKey = `${input.runId}\u0000${input.actionIdempotencyKey}`;
    const existingId = this.executionByRunActionKey.get(actionKey);
    if (existingId !== undefined) {
      const existing = this.executions.get(existingId)!;
      if (existing.action_hash !== input.actionHash || existing.action_id !== input.actionId) {
        throw new WorkflowError('invalid_persisted_state', `action idempotency collision: ${input.actionIdempotencyKey}`);
      }
      return clone(existing);
    }
    if (this.executions.has(input.executionId)) {
      throw new WorkflowError('invalid_persisted_state', `execution id collision: ${input.executionId}`);
    }

    // One synchronous critical section in the reference store: reserve first,
    // then publish the claim. If claim construction throws, release reservation.
    const budget = this.budget(input.runId);
    budget.reserve({
      reservationId: input.reservationId,
      dimension: input.budgetDimension,
      amount: input.budgetAmount,
    });

    try {
      const record: ActionExecutionRecord = {
        schema: 'arcp/action-execution/0.1',
        execution_id: input.executionId,
        run_id: input.runId,
        action_id: input.actionId,
        action_hash: input.actionHash,
        action_idempotency_key: input.actionIdempotencyKey,
        lifecycle_status: 'claimed',
        effect_status: 'not-observed',
        reconciliation_status: 'not-required',
        fencing_token: input.fencingToken,
        budget_reservation_id: input.reservationId,
        executor_id: input.executorId,
        provider_idempotency_mode: input.providerIdempotencyMode,
        ...(input.providerIdempotencyKey === undefined ? {} : { provider_idempotency_key: input.providerIdempotencyKey }),
        attempt: 1,
        claimed_at: clone(input.claimedAt),
      };
      this.executions.set(record.execution_id, clone(record));
      this.executionByRunActionKey.set(actionKey, record.execution_id);
      return clone(record);
    } catch (error) {
      budget.release(input.reservationId);
      throw error;
    }
  }

  async markActionExecuting(executionId: string, fencingToken: number, at: ActionExecutionRecord['claimed_at']): Promise<ActionExecutionRecord> {
    const record = this.requireExecution(executionId);
    this.assertFencing(record.run_id, fencingToken);
    if (record.lifecycle_status === 'executing') return clone(record);
    if (record.lifecycle_status !== 'claimed') {
      throw new WorkflowError('invalid_persisted_state', `cannot mark ${record.lifecycle_status} execution as executing`);
    }
    record.lifecycle_status = 'executing';
    record.executing_at = clone(at);
    this.executions.set(executionId, record);
    return clone(record);
  }

  async appendActionReceipt(receipt: ActionReceipt): Promise<void> {
    const existing = this.receipts.get(receipt.receipt_id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(receipt)) {
        throw new WorkflowError('invalid_persisted_state', `receipt id collision: ${receipt.receipt_id}`);
      }
      return;
    }
    const execution = this.requireExecution(receipt.execution_id);
    if (execution.run_id !== receipt.run_id || execution.action_id !== receipt.action_id) {
      throw new WorkflowError('invalid_persisted_state', 'receipt does not bind to execution run/action');
    }
    this.receipts.set(receipt.receipt_id, clone(receipt));
    execution.lifecycle_status = 'receipt-recorded';
    execution.effect_status = receipt.status;
    execution.last_receipt_id = receipt.receipt_id;
    execution.reconciliation_status = receipt.status === 'unknown' ? 'pending' : 'not-required';
    this.executions.set(execution.execution_id, execution);
    this.budget(execution.run_id).settle(execution.budget_reservation_id, 1);
  }

  async getActionExecution(executionId: string): Promise<ActionExecutionRecord | null> {
    const record = this.executions.get(executionId);
    return record === undefined ? null : clone(record);
  }

  async getActionReceipts(runId: string): Promise<ActionReceipt[]> {
    return [...this.receipts.values()].filter((receipt) => receipt.run_id === runId).map(clone);
  }

  async markActionReconciled(executionId: string, effectStatus: ActionExecutionRecord['effect_status']): Promise<ActionExecutionRecord> {
    const record = this.requireExecution(executionId);
    record.effect_status = effectStatus;
    record.reconciliation_status = effectStatus === 'unknown' ? 'manual-required' : 'reconciled';
    this.executions.set(executionId, record);
    return clone(record);
  }

  async markActionCanonicallyRecorded(executionId: string): Promise<ActionExecutionRecord> {
    const record = this.requireExecution(executionId);
    if (record.lifecycle_status !== 'receipt-recorded') {
      throw new WorkflowError('invalid_persisted_state', 'canonical action record requires a persisted receipt');
    }
    record.lifecycle_status = 'canonically-recorded';
    this.executions.set(executionId, record);
    return clone(record);
  }

  async appendAuthorityResolution(resolution: AuthorityResolution): Promise<void> {
    const list = this.authorities.get(resolution.run_id) ?? [];
    const existing = list.find((item) => item.resolution_id === resolution.resolution_id);
    if (!existing) list.push(clone(resolution));
    else if (JSON.stringify(existing) !== JSON.stringify(resolution)) {
      throw new WorkflowError('invalid_persisted_state', `authority resolution id collision: ${resolution.resolution_id}`);
    }
    this.authorities.set(resolution.run_id, list);
  }

  async getAuthorityResolutions(runId: string): Promise<AuthorityResolution[]> {
    return (this.authorities.get(runId) ?? []).map(clone);
  }

  async createApprovalRequest(request: ApprovalRequest): Promise<ApprovalRequest> {
    const existing = this.approvalRequests.get(request.approval_request_id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(request)) {
        throw new WorkflowError('invalid_persisted_state', `approval request id collision: ${request.approval_request_id}`);
      }
      return clone(existing);
    }
    this.approvalRequests.set(request.approval_request_id, clone(request));
    return clone(request);
  }

  async appendApprovalGrant(grant: ApprovalGrant): Promise<void> {
    const list = this.approvalGrants.get(grant.approval_request_id) ?? [];
    const duplicate = list.find((item) => item.idempotency_key === grant.idempotency_key);
    if (duplicate) {
      if (JSON.stringify(duplicate) !== JSON.stringify(grant)) {
        throw new WorkflowError('invalid_persisted_state', `approval grant idempotency collision: ${grant.idempotency_key}`);
      }
      return;
    }
    list.push(clone(grant));
    this.approvalGrants.set(grant.approval_request_id, list);
  }

  async getApprovalRequest(requestId: string): Promise<ApprovalRequest | null> {
    const item = this.approvalRequests.get(requestId);
    return item === undefined ? null : clone(item);
  }

  async getApprovalGrants(requestId: string): Promise<ApprovalGrant[]> {
    return (this.approvalGrants.get(requestId) ?? []).map(clone);
  }

  async appendContainment(record: ContainmentRecord): Promise<void> {
    this.containments.set(record.containment_id, clone(record));
  }

  async activeContainments(agentId: string): Promise<ContainmentRecord[]> {
    return [...this.containments.values()]
      .filter((item) => item.agent_id === agentId && (item.status === 'active' || item.status === 'review-due' || item.status === 'renewed'))
      .map(clone);
  }

  async appendDeadLetter(record: DeadLetterRecord): Promise<void> {
    const list = this.deadLetters.get(record.run_id) ?? [];
    const existing = list.find((item) => item.dead_letter_id === record.dead_letter_id);
    if (!existing) list.push(clone(record));
    else if (JSON.stringify(existing) !== JSON.stringify(record)) {
      throw new WorkflowError('invalid_persisted_state', `dead-letter id collision: ${record.dead_letter_id}`);
    }
    this.deadLetters.set(record.run_id, list);
  }

  async getDeadLetters(runId: string): Promise<DeadLetterRecord[]> {
    return (this.deadLetters.get(runId) ?? []).map(clone);
  }

  budgetView(runId: string) {
    return this.budget(runId).view();
  }

  private budget(runId: string): InMemoryBudgetLedger {
    const ledger = this.budgets.get(runId);
    if (!ledger) throw new WorkflowError('invalid_persisted_state', `run budget not found: ${runId}`);
    return ledger;
  }

  private assertFencing(runId: string, token: number): void {
    const run = this.runs.get(runId);
    if (!run) throw new WorkflowError('invalid_persisted_state', `run not found: ${runId}`);
    if (run.fencing_token !== token) {
      throw new WorkflowError('stale_fencing_token', `stale fencing token for ${runId}`);
    }
  }

  private requireExecution(executionId: string): ActionExecutionRecord {
    const record = this.executions.get(executionId);
    if (!record) throw new WorkflowError('invalid_persisted_state', `execution not found: ${executionId}`);
    return clone(record);
  }
}
