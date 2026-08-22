import type { InstantRef, ModelInvocationRecord } from './types.js';

/** Phase 5.0A durable budget-envelope records. */
export type BudgetEnvelopeDimension =
  | 'turns'
  | 'wall_time_ms'
  | 'model_input_tokens'
  | 'model_output_tokens'
  | 'model_cost_micros'
  | 'tool_calls'
  | 'external_actions'
  | 'storage_writes'
  | 'network_requests'
  | 'recursive_wakes';

export type BudgetEnvelopeKind =
  | 'advance'
  | 'model-call'
  | 'action-call'
  | 'tool-call'
  | 'storage-operation'
  | 'network-operation'
  | 'recursive-wake';

export type BudgetEnvelopeStatus = 'reserved' | 'settled' | 'released' | 'recovery-required';

export interface BudgetEnvelopeItem {
  dimension: BudgetEnvelopeDimension;
  reserved: number;
  actual?: number;
}

export interface BudgetEnvelopeRecord {
  schema: 'arcp/budget-envelope/0.1';
  envelope_id: string;
  run_id: string;
  fencing_token: number;
  kind: BudgetEnvelopeKind;
  status: BudgetEnvelopeStatus;
  items: BudgetEnvelopeItem[];
  reserved_at: InstantRef;
  settled_at?: InstantRef;
}

/**
 * New Phase 5.0A model calls bind to one multi-dimensional budget envelope.
 * The Phase 4 single-dimension reservation id remains optional only for
 * reading/migrating old records; new canonical writes require envelope id.
 * `structured_output` is provider-neutral durable evidence used to replay an
 * already-succeeded logical turn after a process crash without re-calling the
 * model provider. Workflow-core validates it before treating it as a proposal.
 */
export type Phase5ModelInvocationRecord = Omit<ModelInvocationRecord, 'budget_reservation_id'> & {
  budget_reservation_id?: string;
  budget_envelope_id: string;
  structured_output?: unknown;
};

/**
 * Add the Phase 5.0A envelope link without changing the legacy Phase 4
 * reservation field or wire compatibility of existing records.
 */
declare module './types.js' {
  interface ModelInvocationRecord {
    budget_envelope_id?: string;
  }
}
