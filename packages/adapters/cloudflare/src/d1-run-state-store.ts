import { canonicalize } from '@arcp/schema';
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
import {
  WorkflowError,
  type ActionClaimInput,
  type BudgetDimension,
  type BudgetReservationInput,
  type RunStateStorePort,
} from '@arcp/workflow-core';
import type { D1DatabaseLike } from './d1-types.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function same(left: unknown, right: unknown): boolean {
  return canonicalize(left) === canonicalize(right);
}

function parse<T>(json: string): T {
  return JSON.parse(json) as T;
}

function mapSqlError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('ARCP_BUDGET_EXHAUSTED')) {
    throw new WorkflowError('budget_exhausted', 'D1 bounded run budget exhausted', false, {
      cause: error,
    });
  }
  if (message.includes('ARCP_BUDGET_DIMENSION_MISSING')) {
    throw new WorkflowError('invalid_persisted_state', 'D1 run budget dimension is missing', false, {
      cause: error,
    });
  }
  throw error;
}

function budgetLimits(run: RunRecord): Array<[BudgetDimension, number]> {
  const spec = run.budget_spec;
  return [
    ['turns', spec.max_turns],
    ['wall_time_ms', spec.max_wall_time_ms],
    ['model_input_tokens', spec.max_model_input_tokens ?? 0],
    ['model_output_tokens', spec.max_model_output_tokens ?? 0],
    ['model_cost_micros', spec.max_model_cost_micros ?? 0],
    ['tool_calls', spec.max_tool_calls],
    ['external_actions', spec.max_external_actions],
    ['storage_writes', spec.max_storage_writes],
    ['network_requests', spec.max_network_requests],
    ['recursive_wakes', spec.max_recursive_wakes],
  ];
}

interface ExecutionRow {
  execution_json: string;
  lifecycle_status: ActionExecutionRecord['lifecycle_status'];
  effect_status: ActionExecutionRecord['effect_status'];
  reconciliation_status: ActionExecutionRecord['reconciliation_status'];
}

function executionFromRow(row: ExecutionRow): ActionExecutionRecord {
  return {
    ...parse<ActionExecutionRecord>(row.execution_json),
    lifecycle_status: row.lifecycle_status,
    effect_status: row.effect_status,
    reconciliation_status: row.reconciliation_status,
  };
}

/**
 * D1/SQLite implementation of Phase 4 operational run state. The external
 * action preclaim is one INSERT into arcp_action_executions; migration 0002
 * uses triggers so bounded-budget reservation and the claim share one SQL
 * atomic boundary.
 */
export class D1RunStateStore implements RunStateStorePort {
  constructor(private readonly db: D1DatabaseLike) {}

  async createRunIfAbsent(run: RunRecord): Promise<RunRecord> {
    await this.db.prepare(
      `INSERT OR IGNORE INTO arcp_runs
       (run_id, agent_id, wake_idempotency_key, fencing_token, phase, run_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      run.run_id,
      run.agent_id,
      run.wake_idempotency_key,
      run.fencing_token,
      run.phase,
      JSON.stringify(run),
    ).run();

    const byWake = await this.db.prepare(
      `SELECT run_json FROM arcp_runs WHERE agent_id = ? AND wake_idempotency_key = ?`,
    ).bind(run.agent_id, run.wake_idempotency_key).first<{ run_json: string }>();

    let actual: RunRecord;
    if (byWake) {
      actual = parse<RunRecord>(byWake.run_json);
    } else {
      const byId = await this.db.prepare(
        `SELECT run_json FROM arcp_runs WHERE run_id = ?`,
      ).bind(run.run_id).first<{ run_json: string }>();
      if (!byId) throw new WorkflowError('invalid_persisted_state', 'D1 run insert vanished', false);
      actual = parse<RunRecord>(byId.run_json);
      if (actual.agent_id !== run.agent_id || actual.wake_idempotency_key !== run.wake_idempotency_key) {
        throw new WorkflowError('invalid_persisted_state', `run id collision: ${run.run_id}`, false);
      }
    }

    for (const [dimension, limit] of budgetLimits(actual)) {
      await this.db.prepare(
        `INSERT OR IGNORE INTO arcp_run_budget_ledger
         (run_id, dimension, limit_value, reserved, consumed, released)
         VALUES (?, ?, ?, 0, 0, 0)`,
      ).bind(actual.run_id, dimension, limit).run();
    }
    return clone(actual);
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const row = await this.db.prepare(
      `SELECT run_json FROM arcp_runs WHERE run_id = ?`,
    ).bind(runId).first<{ run_json: string }>();
    return row ? parse<RunRecord>(row.run_json) : null;
  }

  async updateRun(run: RunRecord, expectedFencingToken?: number): Promise<RunRecord> {
    const statement = expectedFencingToken === undefined
      ? this.db.prepare(
          `UPDATE arcp_runs SET fencing_token = ?, phase = ?, run_json = ? WHERE run_id = ?`,
        ).bind(run.fencing_token, run.phase, JSON.stringify(run), run.run_id)
      : this.db.prepare(
          `UPDATE arcp_runs SET fencing_token = ?, phase = ?, run_json = ?
           WHERE run_id = ? AND fencing_token = ?`,
        ).bind(run.fencing_token, run.phase, JSON.stringify(run), run.run_id, expectedFencingToken);
    const result = await statement.run();
    if ((result.meta?.changes ?? 0) !== 1) {
      throw new WorkflowError(
        expectedFencingToken === undefined ? 'invalid_persisted_state' : 'stale_fencing_token',
        `D1 run update rejected: ${run.run_id}`,
        false,
      );
    }
    return clone(run);
  }

  async saveCheckpoint(checkpoint: RunCheckpoint): Promise<void> {
    const result = await this.db.prepare(
      `INSERT OR IGNORE INTO arcp_run_checkpoints
       (checkpoint_id, run_id, sequence, checkpoint_json) VALUES (?, ?, ?, ?)`,
    ).bind(
      checkpoint.checkpoint_id,
      checkpoint.run_id,
      checkpoint.sequence,
      JSON.stringify(checkpoint),
    ).run();
    if ((result.meta?.changes ?? 0) === 0) {
      const existing = await this.db.prepare(
        `SELECT checkpoint_json FROM arcp_run_checkpoints WHERE checkpoint_id = ?`,
      ).bind(checkpoint.checkpoint_id).first<{ checkpoint_json: string }>();
      if (!existing || !same(parse(existing.checkpoint_json), checkpoint)) {
        throw new WorkflowError('invalid_persisted_state', `checkpoint id collision: ${checkpoint.checkpoint_id}`, false);
      }
    }
  }

  async getLatestCheckpoint(runId: string): Promise<RunCheckpoint | null> {
    const row = await this.db.prepare(
      `SELECT checkpoint_json FROM arcp_run_checkpoints
       WHERE run_id = ? ORDER BY sequence DESC LIMIT 1`,
    ).bind(runId).first<{ checkpoint_json: string }>();
    return row ? parse<RunCheckpoint>(row.checkpoint_json) : null;
  }

  async reserveModelBudget(runId: string, fencingToken: number, reservation: BudgetReservationInput): Promise<void> {
    await this.assertFencing(runId, fencingToken);
    const existing = await this.db.prepare(
      `SELECT run_id, dimension, amount, status FROM arcp_model_budget_reservations
       WHERE reservation_id = ?`,
    ).bind(reservation.reservationId).first<{
      run_id: string; dimension: string; amount: number; status: string;
    }>();
    if (existing) {
      if (existing.run_id !== runId || existing.dimension !== reservation.dimension || existing.amount !== reservation.amount) {
        throw new WorkflowError('invalid_persisted_state', `model budget reservation collision: ${reservation.reservationId}`, false);
      }
      return;
    }

    const budget = await this.db.prepare(
      `SELECT limit_value, reserved, consumed FROM arcp_run_budget_ledger
       WHERE run_id = ? AND dimension = ?`,
    ).bind(runId, reservation.dimension).first<{ limit_value: number; reserved: number; consumed: number }>();
    if (!budget) throw new WorkflowError('invalid_persisted_state', `missing budget dimension ${reservation.dimension}`, false);
    if (budget.consumed + budget.reserved + reservation.amount > budget.limit_value) {
      throw new WorkflowError('budget_exhausted', `budget exhausted for ${reservation.dimension}`, false);
    }

    await this.db.prepare(
      `INSERT INTO arcp_model_budget_reservations
       (reservation_id, run_id, dimension, amount, status) VALUES (?, ?, ?, ?, 'reserved')`,
    ).bind(reservation.reservationId, runId, reservation.dimension, reservation.amount).run();
    await this.db.prepare(
      `UPDATE arcp_run_budget_ledger SET reserved = reserved + ?
       WHERE run_id = ? AND dimension = ?`,
    ).bind(reservation.amount, runId, reservation.dimension).run();
  }

  async settleModelBudget(runId: string, reservationId: string, actualAmount: number): Promise<void> {
    const row = await this.db.prepare(
      `SELECT dimension, amount, status FROM arcp_model_budget_reservations
       WHERE reservation_id = ? AND run_id = ?`,
    ).bind(reservationId, runId).first<{ dimension: BudgetDimension; amount: number; status: string }>();
    if (!row) throw new WorkflowError('invalid_persisted_state', `unknown model reservation: ${reservationId}`, false);
    if (row.status !== 'reserved') return;
    if (!Number.isFinite(actualAmount) || actualAmount < 0 || actualAmount > row.amount) {
      throw new WorkflowError('invalid_persisted_state', 'settled model budget exceeds reservation', false);
    }
    await this.db.prepare(
      `UPDATE arcp_run_budget_ledger
       SET reserved = reserved - ?, consumed = consumed + ?, released = released + ?
       WHERE run_id = ? AND dimension = ?`,
    ).bind(row.amount, actualAmount, row.amount - actualAmount, runId, row.dimension).run();
    await this.db.prepare(
      `UPDATE arcp_model_budget_reservations SET status = 'settled', actual_amount = ?
       WHERE reservation_id = ? AND status = 'reserved'`,
    ).bind(actualAmount, reservationId).run();
  }

  async appendModelInvocation(record: ModelInvocationRecord): Promise<void> {
    const result = await this.db.prepare(
      `INSERT OR IGNORE INTO arcp_model_invocations (invocation_id, run_id, invocation_json)
       VALUES (?, ?, ?)`,
    ).bind(record.invocation_id, record.run_id, JSON.stringify(record)).run();
    if ((result.meta?.changes ?? 0) === 0) {
      const row = await this.db.prepare(
        `SELECT invocation_json FROM arcp_model_invocations WHERE invocation_id = ?`,
      ).bind(record.invocation_id).first<{ invocation_json: string }>();
      if (!row || !same(parse(row.invocation_json), record)) {
        throw new WorkflowError('invalid_persisted_state', `model invocation id collision: ${record.invocation_id}`, false);
      }
    }
  }

  async reserveBudgetAndClaimAction(input: ActionClaimInput): Promise<ActionExecutionRecord> {
    await this.assertFencing(input.runId, input.fencingToken);
    const existing = await this.db.prepare(
      `SELECT execution_json, lifecycle_status, effect_status, reconciliation_status
       FROM arcp_action_executions WHERE run_id = ? AND action_idempotency_key = ?`,
    ).bind(input.runId, input.actionIdempotencyKey).first<ExecutionRow>();
    if (existing) {
      const record = executionFromRow(existing);
      if (record.action_hash !== input.actionHash || record.action_id !== input.actionId) {
        throw new WorkflowError('invalid_persisted_state', `action idempotency collision: ${input.actionIdempotencyKey}`, false);
      }
      return record;
    }

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

    try {
      await this.db.prepare(
        `INSERT INTO arcp_action_executions
         (execution_id, run_id, action_id, action_hash, action_idempotency_key, fencing_token,
          lifecycle_status, effect_status, reconciliation_status, budget_reservation_id,
          budget_dimension, budget_amount, execution_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        input.executionId, input.runId, input.actionId, input.actionHash, input.actionIdempotencyKey,
        input.fencingToken, record.lifecycle_status, record.effect_status, record.reconciliation_status,
        input.reservationId, input.budgetDimension, input.budgetAmount, JSON.stringify(record),
      ).run();
    } catch (error) {
      mapSqlError(error);
    }
    return record;
  }

  async markActionExecuting(executionId: string, fencingToken: number, at: ActionExecutionRecord['claimed_at']): Promise<ActionExecutionRecord> {
    let record = await this.requireExecution(executionId);
    await this.assertFencing(record.run_id, fencingToken);
    if (record.lifecycle_status === 'executing') return record;
    if (record.lifecycle_status !== 'claimed') {
      throw new WorkflowError('invalid_persisted_state', `cannot mark ${record.lifecycle_status} as executing`, false);
    }
    record = { ...record, lifecycle_status: 'executing', executing_at: clone(at) };
    await this.db.prepare(
      `UPDATE arcp_action_executions SET lifecycle_status = ?, execution_json = ? WHERE execution_id = ?`,
    ).bind(record.lifecycle_status, JSON.stringify(record), executionId).run();
    return record;
  }

  async appendActionReceipt(receipt: ActionReceipt): Promise<void> {
    const existing = await this.db.prepare(
      `SELECT receipt_json FROM arcp_action_receipts WHERE receipt_id = ?`,
    ).bind(receipt.receipt_id).first<{ receipt_json: string }>();
    if (existing) {
      if (!same(parse(existing.receipt_json), receipt)) {
        throw new WorkflowError('invalid_persisted_state', `receipt id collision: ${receipt.receipt_id}`, false);
      }
      return;
    }
    try {
      await this.db.prepare(
        `INSERT INTO arcp_action_receipts (receipt_id, execution_id, run_id, receipt_json)
         VALUES (?, ?, ?, ?)`,
      ).bind(receipt.receipt_id, receipt.execution_id, receipt.run_id, JSON.stringify(receipt)).run();
    } catch (error) {
      mapSqlError(error);
    }
    await this.db.prepare(
      `UPDATE arcp_action_executions
       SET lifecycle_status = 'receipt-recorded', effect_status = ?,
           reconciliation_status = ?, execution_json = execution_json
       WHERE execution_id = ?`,
    ).bind(receipt.status, receipt.status === 'unknown' ? 'pending' : 'not-required', receipt.execution_id).run();
  }

  async getActionExecution(executionId: string): Promise<ActionExecutionRecord | null> {
    const row = await this.db.prepare(
      `SELECT execution_json, lifecycle_status, effect_status, reconciliation_status
       FROM arcp_action_executions WHERE execution_id = ?`,
    ).bind(executionId).first<ExecutionRow>();
    return row ? executionFromRow(row) : null;
  }

  async getActionReceipts(runId: string): Promise<ActionReceipt[]> {
    const { results } = await this.db.prepare(
      `SELECT receipt_json FROM arcp_action_receipts WHERE run_id = ? ORDER BY rowid ASC`,
    ).bind(runId).all<{ receipt_json: string }>();
    return results.map((row) => parse<ActionReceipt>(row.receipt_json));
  }

  async markActionReconciled(executionId: string, effectStatus: ActionExecutionRecord['effect_status']): Promise<ActionExecutionRecord> {
    const status = effectStatus === 'unknown' ? 'manual-required' : 'reconciled';
    await this.db.prepare(
      `UPDATE arcp_action_executions SET effect_status = ?, reconciliation_status = ? WHERE execution_id = ?`,
    ).bind(effectStatus, status, executionId).run();
    return this.requireExecution(executionId);
  }

  async markActionCanonicallyRecorded(executionId: string): Promise<ActionExecutionRecord> {
    const current = await this.requireExecution(executionId);
    if (current.lifecycle_status !== 'receipt-recorded') {
      throw new WorkflowError('invalid_persisted_state', 'canonical action record requires a persisted receipt', false);
    }
    await this.db.prepare(
      `UPDATE arcp_action_executions SET lifecycle_status = 'canonically-recorded' WHERE execution_id = ?`,
    ).bind(executionId).run();
    return this.requireExecution(executionId);
  }

  async appendAuthorityResolution(resolution: AuthorityResolution): Promise<void> {
    await this.insertImmutableJson(
      'arcp_authority_resolutions', 'resolution_id', resolution.resolution_id,
      'resolution_json', resolution, ['run_id', resolution.run_id],
    );
  }

  async getAuthorityResolutions(runId: string): Promise<AuthorityResolution[]> {
    const { results } = await this.db.prepare(
      `SELECT resolution_json FROM arcp_authority_resolutions WHERE run_id = ? ORDER BY rowid ASC`,
    ).bind(runId).all<{ resolution_json: string }>();
    return results.map((row) => parse<AuthorityResolution>(row.resolution_json));
  }

  async createApprovalRequest(request: ApprovalRequest): Promise<ApprovalRequest> {
    const existing = await this.db.prepare(
      `SELECT request_json FROM arcp_approval_requests WHERE approval_request_id = ?`,
    ).bind(request.approval_request_id).first<{ request_json: string }>();
    if (existing) {
      const parsed = parse<ApprovalRequest>(existing.request_json);
      if (!same(parsed, request)) throw new WorkflowError('invalid_persisted_state', `approval request collision: ${request.approval_request_id}`, false);
      return parsed;
    }
    await this.db.prepare(
      `INSERT INTO arcp_approval_requests (approval_request_id, run_id, status, request_json)
       VALUES (?, ?, ?, ?)`,
    ).bind(request.approval_request_id, request.run_id, request.status, JSON.stringify(request)).run();
    return clone(request);
  }

  async appendApprovalGrant(grant: ApprovalGrant): Promise<void> {
    const existing = await this.db.prepare(
      `SELECT grant_json FROM arcp_approval_grants WHERE idempotency_key = ?`,
    ).bind(grant.idempotency_key).first<{ grant_json: string }>();
    if (existing) {
      if (!same(parse(existing.grant_json), grant)) {
        throw new WorkflowError('invalid_persisted_state', `approval grant collision: ${grant.idempotency_key}`, false);
      }
      return;
    }
    await this.db.prepare(
      `INSERT INTO arcp_approval_grants
       (approval_grant_id, approval_request_id, approver_entity_ref, idempotency_key, grant_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      grant.approval_grant_id, grant.approval_request_id, grant.approver_entity_ref,
      grant.idempotency_key, JSON.stringify(grant),
    ).run();
  }

  async getApprovalRequest(requestId: string): Promise<ApprovalRequest | null> {
    const row = await this.db.prepare(
      `SELECT request_json FROM arcp_approval_requests WHERE approval_request_id = ?`,
    ).bind(requestId).first<{ request_json: string }>();
    return row ? parse<ApprovalRequest>(row.request_json) : null;
  }

  async getApprovalGrants(requestId: string): Promise<ApprovalGrant[]> {
    const { results } = await this.db.prepare(
      `SELECT grant_json FROM arcp_approval_grants WHERE approval_request_id = ? ORDER BY rowid ASC`,
    ).bind(requestId).all<{ grant_json: string }>();
    return results.map((row) => parse<ApprovalGrant>(row.grant_json));
  }

  async appendContainment(record: ContainmentRecord): Promise<void> {
    await this.db.prepare(
      `INSERT INTO arcp_containments (containment_id, agent_id, status, containment_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(containment_id) DO UPDATE SET status = excluded.status,
         containment_json = excluded.containment_json`,
    ).bind(record.containment_id, record.agent_id, record.status, JSON.stringify(record)).run();
  }

  async activeContainments(agentId: string): Promise<ContainmentRecord[]> {
    const { results } = await this.db.prepare(
      `SELECT containment_json FROM arcp_containments
       WHERE agent_id = ? AND status IN ('active','review-due','renewed') ORDER BY rowid ASC`,
    ).bind(agentId).all<{ containment_json: string }>();
    return results.map((row) => parse<ContainmentRecord>(row.containment_json));
  }

  async appendDeadLetter(record: DeadLetterRecord): Promise<void> {
    await this.insertImmutableJson(
      'arcp_dead_letters', 'dead_letter_id', record.dead_letter_id,
      'dead_letter_json', record, ['run_id', record.run_id],
    );
  }

  async getDeadLetters(runId: string): Promise<DeadLetterRecord[]> {
    const { results } = await this.db.prepare(
      `SELECT dead_letter_json FROM arcp_dead_letters WHERE run_id = ? ORDER BY rowid ASC`,
    ).bind(runId).all<{ dead_letter_json: string }>();
    return results.map((row) => parse<DeadLetterRecord>(row.dead_letter_json));
  }

  private async assertFencing(runId: string, fencingToken: number): Promise<void> {
    const row = await this.db.prepare(
      `SELECT fencing_token FROM arcp_runs WHERE run_id = ?`,
    ).bind(runId).first<{ fencing_token: number }>();
    if (!row) throw new WorkflowError('invalid_persisted_state', `run not found: ${runId}`, false);
    if (row.fencing_token !== fencingToken) {
      throw new WorkflowError('stale_fencing_token', `stale fencing token for ${runId}`, false);
    }
  }

  private async requireExecution(executionId: string): Promise<ActionExecutionRecord> {
    const record = await this.getActionExecution(executionId);
    if (!record) throw new WorkflowError('invalid_persisted_state', `execution not found: ${executionId}`, false);
    return record;
  }

  private async insertImmutableJson(
    table: string,
    idColumn: string,
    id: string,
    jsonColumn: string,
    value: unknown,
    extra: [string, string],
  ): Promise<void> {
    const existing = await this.db.prepare(
      `SELECT ${jsonColumn} FROM ${table} WHERE ${idColumn} = ?`,
    ).bind(id).first<Record<string, string>>();
    if (existing) {
      if (!same(parse(existing[jsonColumn]!), value)) {
        throw new WorkflowError('invalid_persisted_state', `${table} id collision: ${id}`, false);
      }
      return;
    }
    await this.db.prepare(
      `INSERT INTO ${table} (${idColumn}, ${extra[0]}, ${jsonColumn}) VALUES (?, ?, ?)`,
    ).bind(id, extra[1], JSON.stringify(value)).run();
  }
}
