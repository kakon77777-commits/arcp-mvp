import type { RiskLevel, RunBudgetSpec } from '@arcp/schema';
import { WorkflowError } from './errors.js';

export const DEFAULT_BOUNDED_RUN_BUDGET: Readonly<RunBudgetSpec> = Object.freeze({
  max_turns: 4,
  max_wall_time_ms: 120_000,
  max_model_input_tokens: 64_000,
  max_model_output_tokens: 16_000,
  max_model_cost_micros: 1_000_000,
  max_tool_calls: 12,
  max_external_actions: 8,
  max_storage_writes: 8,
  max_network_requests: 16,
  max_recursive_wakes: 2,
  max_risk: 'R2',
});

export type BudgetDimension =
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

export interface BudgetCounterView {
  limit: number;
  reserved: number;
  consumed: number;
  released: number;
}

export type RunBudgetView = Partial<Record<BudgetDimension, BudgetCounterView>>;

export interface BudgetReservation {
  reservationId: string;
  dimension: BudgetDimension;
  amount: number;
}

const RISK_ORDER: Record<RiskLevel, number> = { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4 };

export function compareRisk(left: RiskLevel, right: RiskLevel): number {
  return RISK_ORDER[left] - RISK_ORDER[right];
}

function limitFor(spec: RunBudgetSpec, dimension: BudgetDimension): number {
  switch (dimension) {
    case 'turns': return spec.max_turns;
    case 'wall_time_ms': return spec.max_wall_time_ms;
    case 'model_input_tokens': return spec.max_model_input_tokens ?? 0;
    case 'model_output_tokens': return spec.max_model_output_tokens ?? 0;
    case 'model_cost_micros': return spec.max_model_cost_micros ?? 0;
    case 'tool_calls': return spec.max_tool_calls;
    case 'external_actions': return spec.max_external_actions;
    case 'storage_writes': return spec.max_storage_writes;
    case 'network_requests': return spec.max_network_requests;
    case 'recursive_wakes': return spec.max_recursive_wakes;
  }
}

interface MutableCounter extends BudgetCounterView {}

export class InMemoryBudgetLedger {
  private readonly counters = new Map<BudgetDimension, MutableCounter>();
  private readonly reservations = new Map<string, BudgetReservation>();

  constructor(public readonly spec: RunBudgetSpec = { ...DEFAULT_BOUNDED_RUN_BUDGET }) {
    const dimensions: BudgetDimension[] = [
      'turns', 'wall_time_ms', 'model_input_tokens', 'model_output_tokens', 'model_cost_micros',
      'tool_calls', 'external_actions', 'storage_writes', 'network_requests', 'recursive_wakes',
    ];
    for (const dimension of dimensions) {
      this.counters.set(dimension, {
        limit: limitFor(spec, dimension),
        reserved: 0,
        consumed: 0,
        released: 0,
      });
    }
  }

  view(): RunBudgetView {
    return Object.fromEntries(
      [...this.counters.entries()].map(([dimension, counter]) => [dimension, { ...counter }]),
    ) as RunBudgetView;
  }

  reserve(input: { reservationId: string; dimension: BudgetDimension; amount: number }): BudgetReservation {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new WorkflowError('invalid_persisted_state', 'budget reservation amount must be positive', false);
    }
    const existing = this.reservations.get(input.reservationId);
    if (existing !== undefined) {
      if (existing.dimension !== input.dimension || existing.amount !== input.amount) {
        throw new WorkflowError('invalid_persisted_state', `reservation id collision: ${input.reservationId}`, false);
      }
      return { ...existing };
    }

    const counter = this.counters.get(input.dimension)!;
    if (counter.consumed + counter.reserved + input.amount > counter.limit) {
      throw new WorkflowError('budget_exhausted', `budget exhausted for ${input.dimension}`, false);
    }
    counter.reserved += input.amount;
    const reservation = { ...input };
    this.reservations.set(input.reservationId, reservation);
    return reservation;
  }

  settle(reservationId: string, actualAmount: number): void {
    const reservation = this.reservations.get(reservationId);
    if (reservation === undefined) {
      throw new WorkflowError('invalid_persisted_state', `unknown reservation: ${reservationId}`, false);
    }
    if (!Number.isFinite(actualAmount) || actualAmount < 0 || actualAmount > reservation.amount) {
      throw new WorkflowError('invalid_persisted_state', 'settled amount must be within reserved amount', false);
    }
    const counter = this.counters.get(reservation.dimension)!;
    counter.reserved -= reservation.amount;
    counter.consumed += actualAmount;
    counter.released += reservation.amount - actualAmount;
    this.reservations.delete(reservationId);
  }

  release(reservationId: string): void {
    const reservation = this.reservations.get(reservationId);
    if (reservation === undefined) return;
    const counter = this.counters.get(reservation.dimension)!;
    counter.reserved -= reservation.amount;
    counter.released += reservation.amount;
    this.reservations.delete(reservationId);
  }

  consumeActiveWallTime(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new WorkflowError('invalid_persisted_state', 'wall time must be non-negative', false);
    }
    const counter = this.counters.get('wall_time_ms')!;
    if (counter.consumed + counter.reserved + milliseconds > counter.limit) {
      throw new WorkflowError('budget_exhausted', 'active wall-time budget exhausted', false);
    }
    counter.consumed += milliseconds;
  }

  consume(dimension: BudgetDimension, amount: number): void {
    const reservationId = `direct:${dimension}:${this.reservations.size}:${Date.now()}`;
    const reservation = this.reserve({ reservationId, dimension, amount });
    this.settle(reservation.reservationId, amount);
  }
}
