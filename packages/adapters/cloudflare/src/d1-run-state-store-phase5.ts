import { canonicalize } from '@arcp/schema';
import type { BudgetEnvelopeRecord, Phase5ModelInvocationRecord } from '@arcp/schema';
import type { D1DatabaseLike } from './d1-types.js';
import { D1RunStateStore as Phase4D1RunStateStore } from './d1-run-state-store.js';
import {
  WorkflowError,
  type BudgetDimension,
  type CompleteRunBudgetView,
  type Phase5RunStateStorePort,
  type ReleaseBudgetEnvelopeInput,
  type ReserveBudgetEnvelopeInput,
  type SettleBudgetEnvelopeInput,
} from '@arcp/workflow-core';

const DIMENSIONS: BudgetDimension[] = [
  'turns',
  'wall_time_ms',
  'model_input_tokens',
  'model_output_tokens',
  'model_cost_micros',
  'tool_calls',
  'external_actions',
  'storage_writes',
  'network_requests',
  'recursive_wakes',
];

interface BudgetRow {
  dimension: string;
  limit_value: number;
  reserved: number;
  consumed: number;
  released: number;
}

interface EnvelopeRow {
  envelope_json: string;
}

interface InvocationRow {
  status: string | null;
  budget_envelope_id: string | null;
  invocation_json: string;
}

function envelopeBinding(record: BudgetEnvelopeRecord): unknown {
  return {
    envelope_id: record.envelope_id,
    run_id: record.run_id,
    fencing_token: record.fencing_token,
    kind: record.kind,
    items: record.items.map(({ dimension, reserved }) => ({ dimension, reserved })),
    reserved_at: record.reserved_at,
  };
}

function canTransitionInvocation(
  from: Phase5ModelInvocationRecord['status'],
  to: Phase5ModelInvocationRecord['status'],
): boolean {
  if (from === 'reserved') return to === 'calling' || to === 'failed';
  if (from === 'calling') return to === 'succeeded' || to === 'failed' || to === 'unknown';
  return false;
}

function assertSameInvocationBinding(
  current: Phase5ModelInvocationRecord,
  next: Phase5ModelInvocationRecord,
): void {
  if (
    next.invocation_id !== current.invocation_id
    || next.run_id !== current.run_id
    || next.turn_index !== current.turn_index
    || next.budget_envelope_id !== current.budget_envelope_id
    || next.input_hash !== current.input_hash
  ) {
    throw new WorkflowError('invalid_persisted_state', `model invocation binding changed: ${current.invocation_id}`, false);
  }
}

function mapEnvelopeSqlError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('ARCP_BUDGET_EXHAUSTED')) {
    throw new WorkflowError('budget_exhausted', 'D1 budget envelope exceeds run budget', false, { cause: error });
  }
  if (message.includes('ARCP_STALE_FENCING')) {
    throw new WorkflowError('stale_fencing_token', 'D1 budget envelope rejected stale fencing', false, { cause: error });
  }
  if (message.includes('ARCP_ENVELOPE_INVALID') || message.includes('ARCP_BUDGET_DIMENSION_MISSING')) {
    throw new WorkflowError('budget_envelope_invalid', 'D1 budget envelope is invalid', false, { cause: error });
  }
  throw error;
}

/**
 * Phase 5.0A adapter wrapper. The Phase 4 store remains readable/exportable
 * under an explicit legacy name while the package-level D1RunStateStore
 * points to this stronger contract during the staged migration.
 */
export class Phase5D1RunStateStore
  extends Phase4D1RunStateStore
  implements Phase5RunStateStorePort {
  constructor(private readonly phase5Db: D1DatabaseLike) {
    super(phase5Db);
  }

  async getBudgetView(runId: string): Promise<CompleteRunBudgetView> {
    if ((await this.getRun(runId)) === null) {
      throw new WorkflowError('invalid_persisted_state', `run not found: ${runId}`, false);
    }

    const query = await this.phase5Db.prepare(
      `SELECT dimension, limit_value, reserved, consumed, released
       FROM arcp_run_budget_ledger WHERE run_id = ? ORDER BY dimension`,
    ).bind(runId).all<BudgetRow>();
    if (!query.success) {
      throw new WorkflowError('invalid_persisted_state', `D1 budget view query failed: ${runId}`, false);
    }

    const seen = new Set<string>();
    const output: Partial<CompleteRunBudgetView> = {};
    for (const row of query.results) {
      if (!DIMENSIONS.includes(row.dimension as BudgetDimension) || seen.has(row.dimension)) {
        throw new WorkflowError('invalid_persisted_state', `D1 run budget has unknown/duplicate dimension: ${row.dimension}`, false);
      }
      seen.add(row.dimension);
      output[row.dimension as BudgetDimension] = {
        limit: row.limit_value,
        reserved: row.reserved,
        consumed: row.consumed,
        released: row.released,
      };
    }

    if (seen.size !== DIMENSIONS.length || DIMENSIONS.some((dimension) => output[dimension] === undefined)) {
      throw new WorkflowError('invalid_persisted_state', `D1 run budget is incomplete: ${runId}`, false);
    }
    return output as CompleteRunBudgetView;
  }

  async reserveBudgetEnvelope(input: ReserveBudgetEnvelopeInput): Promise<BudgetEnvelopeRecord> {
    const run = await this.getRun(input.runId);
    if (!run) throw new WorkflowError('invalid_persisted_state', `run not found: ${input.runId}`, false);
    if (run.fencing_token !== input.fencingToken) {
      throw new WorkflowError('stale_fencing_token', `stale fencing token for ${input.runId}`, false);
    }

    const candidate: BudgetEnvelopeRecord = {
      schema: 'arcp/budget-envelope/0.1',
      envelope_id: input.envelopeId,
      run_id: input.runId,
      fencing_token: input.fencingToken,
      kind: input.kind,
      status: 'reserved',
      items: input.items.map(({ dimension, amount }) => ({ dimension, reserved: amount })),
      reserved_at: structuredClone(input.reservedAt),
    };

    const existing = await this.getBudgetEnvelope(input.envelopeId);
    if (existing) {
      if (canonicalize(envelopeBinding(existing)) !== canonicalize(envelopeBinding(candidate))) {
        throw new WorkflowError('budget_envelope_conflict', `budget envelope id collision: ${input.envelopeId}`, false);
      }
      return existing;
    }

    try {
      await this.phase5Db.prepare(
        `INSERT INTO arcp_budget_envelopes
         (envelope_id, run_id, fencing_token, kind, status, items_json, actuals_json, envelope_json)
         VALUES (?, ?, ?, ?, 'reserved', ?, NULL, ?)`,
      ).bind(
        candidate.envelope_id,
        candidate.run_id,
        candidate.fencing_token,
        candidate.kind,
        JSON.stringify(candidate.items),
        JSON.stringify(candidate),
      ).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('UNIQUE constraint failed')) {
        const raced = await this.getBudgetEnvelope(input.envelopeId);
        if (raced && canonicalize(envelopeBinding(raced)) === canonicalize(envelopeBinding(candidate))) {
          return raced;
        }
        throw new WorkflowError('budget_envelope_conflict', `budget envelope id collision: ${input.envelopeId}`, false, { cause: error });
      }
      mapEnvelopeSqlError(error);
    }
    return (await this.getBudgetEnvelope(input.envelopeId))!;
  }

  async settleBudgetEnvelope(input: SettleBudgetEnvelopeInput): Promise<BudgetEnvelopeRecord> {
    const existing = await this.requireEnvelope(input.envelopeId, input.runId);
    if (existing.status === 'settled') return existing;
    if (existing.status !== 'reserved') {
      throw new WorkflowError('budget_envelope_invalid', `cannot settle envelope from ${existing.status}`, false);
    }

    const actualKeys = Object.keys(input.actuals);
    if (actualKeys.length !== existing.items.length) {
      throw new WorkflowError('budget_envelope_invalid', 'settlement requires an actual for every reserved dimension', false);
    }
    const actuals = existing.items.map((item) => {
      const actual = input.actuals[item.dimension];
      if (actual === undefined || !Number.isFinite(actual) || actual < 0 || actual > item.reserved) {
        throw new WorkflowError('budget_envelope_invalid', `invalid/missing actual for ${item.dimension}`, false);
      }
      return { dimension: item.dimension, actual };
    });
    if (actualKeys.some((key) => !existing.items.some((item) => item.dimension === key))) {
      throw new WorkflowError('budget_envelope_invalid', 'settlement contains non-reserved dimension', false);
    }

    const settled: BudgetEnvelopeRecord = {
      ...existing,
      status: 'settled',
      items: existing.items.map((item) => ({ ...item, actual: input.actuals[item.dimension]! })),
      settled_at: structuredClone(input.settledAt),
    };
    try {
      const result = await this.phase5Db.prepare(
        `UPDATE arcp_budget_envelopes
         SET status = 'settled', actuals_json = ?, envelope_json = ?
         WHERE envelope_id = ? AND run_id = ? AND status = 'reserved'`,
      ).bind(JSON.stringify(actuals), JSON.stringify(settled), input.envelopeId, input.runId).run();
      if ((result.meta?.changes ?? 0) !== 1) {
        const raced = await this.requireEnvelope(input.envelopeId, input.runId);
        if (raced.status === 'settled') return raced;
        throw new WorkflowError('budget_envelope_invalid', `budget envelope settle race: ${input.envelopeId}`, false);
      }
    } catch (error) {
      if (error instanceof WorkflowError) throw error;
      mapEnvelopeSqlError(error);
    }
    return (await this.getBudgetEnvelope(input.envelopeId))!;
  }

  async releaseBudgetEnvelope(input: ReleaseBudgetEnvelopeInput): Promise<BudgetEnvelopeRecord> {
    const existing = await this.requireEnvelope(input.envelopeId, input.runId);
    if (existing.status === 'released') return existing;
    if (existing.status !== 'reserved') {
      throw new WorkflowError('budget_envelope_invalid', `cannot release envelope from ${existing.status}`, false);
    }
    const released: BudgetEnvelopeRecord = { ...existing, status: 'released' };
    try {
      const result = await this.phase5Db.prepare(
        `UPDATE arcp_budget_envelopes SET status = 'released', envelope_json = ?
         WHERE envelope_id = ? AND run_id = ? AND status = 'reserved'`,
      ).bind(JSON.stringify(released), input.envelopeId, input.runId).run();
      if ((result.meta?.changes ?? 0) !== 1) {
        throw new WorkflowError('budget_envelope_invalid', `budget envelope release race: ${input.envelopeId}`, false);
      }
    } catch (error) {
      if (error instanceof WorkflowError) throw error;
      mapEnvelopeSqlError(error);
    }
    return (await this.getBudgetEnvelope(input.envelopeId))!;
  }

  async markBudgetEnvelopeRecoveryRequired(runId: string, envelopeId: string): Promise<BudgetEnvelopeRecord> {
    const existing = await this.requireEnvelope(envelopeId, runId);
    if (existing.status === 'recovery-required') return existing;
    if (existing.status !== 'reserved') {
      throw new WorkflowError('budget_envelope_invalid', `cannot mark ${existing.status} envelope recovery-required`, false);
    }
    const recovery: BudgetEnvelopeRecord = { ...existing, status: 'recovery-required' };
    const result = await this.phase5Db.prepare(
      `UPDATE arcp_budget_envelopes SET status = 'recovery-required', envelope_json = ?
       WHERE envelope_id = ? AND run_id = ? AND status = 'reserved'`,
    ).bind(JSON.stringify(recovery), envelopeId, runId).run();
    if ((result.meta?.changes ?? 0) !== 1) {
      throw new WorkflowError('budget_envelope_invalid', `budget envelope recovery transition race: ${envelopeId}`, false);
    }
    return (await this.getBudgetEnvelope(envelopeId))!;
  }

  async getBudgetEnvelope(envelopeId: string): Promise<BudgetEnvelopeRecord | null> {
    const row = await this.phase5Db.prepare(
      `SELECT envelope_json FROM arcp_budget_envelopes WHERE envelope_id = ?`,
    ).bind(envelopeId).first<EnvelopeRow>();
    return row ? JSON.parse(row.envelope_json) as BudgetEnvelopeRecord : null;
  }

  async createModelInvocation(record: Phase5ModelInvocationRecord): Promise<Phase5ModelInvocationRecord> {
    if ((await this.getRun(record.run_id)) === null) {
      throw new WorkflowError('invalid_persisted_state', `run not found: ${record.run_id}`, false);
    }
    const result = await this.phase5Db.prepare(
      `INSERT OR IGNORE INTO arcp_model_invocations
       (invocation_id, run_id, status, budget_envelope_id, invocation_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      record.invocation_id,
      record.run_id,
      record.status,
      record.budget_envelope_id,
      JSON.stringify(record),
    ).run();
    if ((result.meta?.changes ?? 0) === 0) {
      const existing = await this.getModelInvocation(record.invocation_id);
      if (!existing || canonicalize(existing) !== canonicalize(record)) {
        throw new WorkflowError('invalid_persisted_state', `model invocation id collision: ${record.invocation_id}`, false);
      }
      return existing;
    }
    return structuredClone(record);
  }

  async getModelInvocation(invocationId: string): Promise<Phase5ModelInvocationRecord | null> {
    const row = await this.phase5Db.prepare(
      `SELECT status, budget_envelope_id, invocation_json
       FROM arcp_model_invocations WHERE invocation_id = ?`,
    ).bind(invocationId).first<InvocationRow>();
    if (!row) return null;
    if (!row.status || !row.budget_envelope_id) {
      throw new WorkflowError('invalid_persisted_state', `Phase 5 model invocation lacks lifecycle fields: ${invocationId}`, false);
    }
    const parsed = JSON.parse(row.invocation_json) as Phase5ModelInvocationRecord;
    return {
      ...parsed,
      status: row.status as Phase5ModelInvocationRecord['status'],
      budget_envelope_id: row.budget_envelope_id,
    };
  }

  async transitionModelInvocation(
    invocationId: string,
    expectedStatus: Phase5ModelInvocationRecord['status'],
    next: Phase5ModelInvocationRecord,
  ): Promise<Phase5ModelInvocationRecord> {
    const current = await this.getModelInvocation(invocationId);
    if (!current || current.status !== expectedStatus) {
      throw new WorkflowError('invalid_persisted_state', `stale model invocation transition: ${invocationId}`, false);
    }
    assertSameInvocationBinding(current, next);
    if (!canTransitionInvocation(current.status, next.status)) {
      throw new WorkflowError('invalid_persisted_state', `invalid model invocation transition: ${current.status} -> ${next.status}`, false);
    }

    const result = await this.phase5Db.prepare(
      `UPDATE arcp_model_invocations
       SET status = ?, budget_envelope_id = ?, invocation_json = ?
       WHERE invocation_id = ? AND status = ?`,
    ).bind(
      next.status,
      next.budget_envelope_id,
      JSON.stringify(next),
      invocationId,
      expectedStatus,
    ).run();
    if ((result.meta?.changes ?? 0) !== 1) {
      throw new WorkflowError('invalid_persisted_state', `stale model invocation transition: ${invocationId}`, false);
    }
    return structuredClone(next);
  }

  private async requireEnvelope(envelopeId: string, runId: string): Promise<BudgetEnvelopeRecord> {
    const record = await this.getBudgetEnvelope(envelopeId);
    if (!record || record.run_id !== runId) {
      throw new WorkflowError('budget_envelope_invalid', `budget envelope not found: ${envelopeId}`, false);
    }
    return record;
  }
}
