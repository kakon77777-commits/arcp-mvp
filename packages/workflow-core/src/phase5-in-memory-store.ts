import { canonicalize } from '@arcp/schema';
import type { BudgetEnvelopeRecord, Phase5ModelInvocationRecord } from '@arcp/schema';
import { InMemoryRunStateStore as Phase4InMemoryRunStateStore } from './in-memory-store.js';
import type { BudgetDimension, CompleteRunBudgetView } from './budget.js';
import { WorkflowError } from './errors.js';
import type { Phase5RunStateStorePort } from './phase5-run-state-store.js';
import type {
  ReleaseBudgetEnvelopeInput,
  ReserveBudgetEnvelopeInput,
  SettleBudgetEnvelopeInput,
} from './types.js';

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

/** Phase 5.0A-compatible in-memory store layered over the Phase 4 implementation. */
export class Phase5InMemoryRunStateStore
  extends Phase4InMemoryRunStateStore
  implements Phase5RunStateStorePort {
  private readonly envelopes = new Map<string, BudgetEnvelopeRecord>();
  private readonly phase5ModelInvocations = new Map<string, Phase5ModelInvocationRecord>();

  async getBudgetView(runId: string): Promise<CompleteRunBudgetView> {
    const base = this.budgetView(runId);
    const keys = Object.keys(base);
    if (keys.length !== DIMENSIONS.length || DIMENSIONS.some((dimension) => base[dimension] === undefined)) {
      throw new WorkflowError('invalid_persisted_state', `in-memory run budget is incomplete: ${runId}`, false);
    }
    const view = structuredClone(base) as CompleteRunBudgetView;

    for (const envelope of this.envelopes.values()) {
      if (envelope.run_id !== runId) continue;
      for (const item of envelope.items) {
        const counter = view[item.dimension];
        if (envelope.status === 'reserved' || envelope.status === 'recovery-required') {
          counter.reserved += item.reserved;
        } else if (envelope.status === 'settled') {
          if (item.actual === undefined) {
            throw new WorkflowError('invalid_persisted_state', `settled envelope lacks actual: ${envelope.envelope_id}`, false);
          }
          counter.consumed += item.actual;
          counter.released += item.reserved - item.actual;
        } else if (envelope.status === 'released') {
          counter.released += item.reserved;
        }
      }
    }
    return view;
  }

  async reserveBudgetEnvelope(input: ReserveBudgetEnvelopeInput): Promise<BudgetEnvelopeRecord> {
    const run = await this.getRun(input.runId);
    if (!run) throw new WorkflowError('invalid_persisted_state', `run not found: ${input.runId}`, false);
    if (run.fencing_token !== input.fencingToken) {
      throw new WorkflowError('stale_fencing_token', `stale fencing token for ${input.runId}`, false);
    }
    this.validateReservationItems(input.items);

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

    const existing = this.envelopes.get(input.envelopeId);
    if (existing) {
      if (canonicalize(envelopeBinding(existing)) !== canonicalize(envelopeBinding(candidate))) {
        throw new WorkflowError('budget_envelope_conflict', `budget envelope id collision: ${input.envelopeId}`, false);
      }
      return structuredClone(existing);
    }

    const view = await this.getBudgetView(input.runId);
    for (const item of input.items) {
      const counter = view[item.dimension];
      if (counter.consumed + counter.reserved + item.amount > counter.limit) {
        throw new WorkflowError('budget_exhausted', `budget exhausted for ${item.dimension}`, false);
      }
    }

    this.envelopes.set(input.envelopeId, structuredClone(candidate));
    return structuredClone(candidate);
  }

  async settleBudgetEnvelope(input: SettleBudgetEnvelopeInput): Promise<BudgetEnvelopeRecord> {
    const existing = this.requireEnvelope(input.envelopeId, input.runId);
    if (existing.status === 'settled') return structuredClone(existing);
    if (existing.status !== 'reserved' && existing.status !== 'recovery-required') {
      throw new WorkflowError('budget_envelope_invalid', `cannot settle envelope from ${existing.status}`, false);
    }

    const actualKeys = Object.keys(input.actuals);
    if (actualKeys.length !== existing.items.length) {
      throw new WorkflowError('budget_envelope_invalid', 'settlement requires an actual for every reserved dimension', false);
    }
    const actualSet = new Set(actualKeys);
    for (const item of existing.items) {
      if (!actualSet.has(item.dimension)) {
        throw new WorkflowError('budget_envelope_invalid', `missing actual for ${item.dimension}`, false);
      }
      const actual = input.actuals[item.dimension];
      if (actual === undefined || !Number.isFinite(actual) || actual < 0 || actual > item.reserved) {
        throw new WorkflowError('budget_envelope_invalid', `invalid actual for ${item.dimension}`, false);
      }
    }
    if (actualKeys.some((key) => !DIMENSIONS.includes(key as BudgetDimension))) {
      throw new WorkflowError('budget_envelope_invalid', 'settlement contains unknown dimension', false);
    }

    const settled: BudgetEnvelopeRecord = {
      ...existing,
      status: 'settled',
      items: existing.items.map((item) => ({ ...item, actual: input.actuals[item.dimension]! })),
      settled_at: structuredClone(input.settledAt),
    };
    this.envelopes.set(existing.envelope_id, structuredClone(settled));
    return structuredClone(settled);
  }

  async releaseBudgetEnvelope(input: ReleaseBudgetEnvelopeInput): Promise<BudgetEnvelopeRecord> {
    const existing = this.requireEnvelope(input.envelopeId, input.runId);
    if (existing.status === 'released') return structuredClone(existing);
    if (existing.status !== 'reserved') {
      throw new WorkflowError('budget_envelope_invalid', `cannot release envelope from ${existing.status}`, false);
    }
    const released: BudgetEnvelopeRecord = { ...existing, status: 'released' };
    this.envelopes.set(existing.envelope_id, structuredClone(released));
    return structuredClone(released);
  }

  async markBudgetEnvelopeRecoveryRequired(runId: string, envelopeId: string): Promise<BudgetEnvelopeRecord> {
    const existing = this.requireEnvelope(envelopeId, runId);
    if (existing.status === 'recovery-required') return structuredClone(existing);
    if (existing.status !== 'reserved') {
      throw new WorkflowError('budget_envelope_invalid', `cannot mark ${existing.status} envelope recovery-required`, false);
    }
    const recovery: BudgetEnvelopeRecord = { ...existing, status: 'recovery-required' };
    this.envelopes.set(existing.envelope_id, structuredClone(recovery));
    return structuredClone(recovery);
  }

  async getBudgetEnvelope(envelopeId: string): Promise<BudgetEnvelopeRecord | null> {
    const record = this.envelopes.get(envelopeId);
    return record ? structuredClone(record) : null;
  }

  async createModelInvocation(record: Phase5ModelInvocationRecord): Promise<Phase5ModelInvocationRecord> {
    if ((await this.getRun(record.run_id)) === null) {
      throw new WorkflowError('invalid_persisted_state', `run not found: ${record.run_id}`, false);
    }
    const existing = this.phase5ModelInvocations.get(record.invocation_id);
    if (existing) {
      if (canonicalize(existing) !== canonicalize(record)) {
        throw new WorkflowError('invalid_persisted_state', `model invocation id collision: ${record.invocation_id}`, false);
      }
      return structuredClone(existing);
    }
    this.phase5ModelInvocations.set(record.invocation_id, structuredClone(record));
    return structuredClone(record);
  }

  async getModelInvocation(invocationId: string): Promise<Phase5ModelInvocationRecord | null> {
    const record = this.phase5ModelInvocations.get(invocationId);
    return record ? structuredClone(record) : null;
  }

  async transitionModelInvocation(
    invocationId: string,
    expectedStatus: Phase5ModelInvocationRecord['status'],
    next: Phase5ModelInvocationRecord,
  ): Promise<Phase5ModelInvocationRecord> {
    const current = this.phase5ModelInvocations.get(invocationId);
    if (!current || current.status !== expectedStatus) {
      throw new WorkflowError('invalid_persisted_state', `stale model invocation transition: ${invocationId}`, false);
    }
    assertSameInvocationBinding(current, next);
    if (!canTransitionInvocation(current.status, next.status)) {
      throw new WorkflowError('invalid_persisted_state', `invalid model invocation transition: ${current.status} -> ${next.status}`, false);
    }
    this.phase5ModelInvocations.set(invocationId, structuredClone(next));
    return structuredClone(next);
  }

  private validateReservationItems(items: ReserveBudgetEnvelopeInput['items']): void {
    if (items.length === 0) {
      throw new WorkflowError('budget_envelope_invalid', 'budget envelope must reserve at least one dimension', false);
    }
    const seen = new Set<BudgetDimension>();
    for (const item of items) {
      if (!DIMENSIONS.includes(item.dimension) || seen.has(item.dimension)) {
        throw new WorkflowError('budget_envelope_invalid', `unknown/duplicate envelope dimension: ${item.dimension}`, false);
      }
      if (!Number.isFinite(item.amount) || item.amount <= 0) {
        throw new WorkflowError('budget_envelope_invalid', `invalid reservation amount for ${item.dimension}`, false);
      }
      seen.add(item.dimension);
    }
  }

  private requireEnvelope(envelopeId: string, runId: string): BudgetEnvelopeRecord {
    const record = this.envelopes.get(envelopeId);
    if (!record || record.run_id !== runId) {
      throw new WorkflowError('budget_envelope_invalid', `budget envelope not found: ${envelopeId}`, false);
    }
    return structuredClone(record);
  }
}
