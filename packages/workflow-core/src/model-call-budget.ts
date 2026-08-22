import type { BudgetEnvelopeRecord } from '@arcp/schema';
import { budgetAvailable, type BudgetDimension, type CompleteRunBudgetView } from './budget.js';
import { WorkflowError } from './errors.js';
import type { ModelCallLimits, ModelTurnProposal, ReserveBudgetEnvelopeInput } from './types.js';

const MODEL_DIMENSIONS = [
  'model_input_tokens',
  'model_output_tokens',
  'model_cost_micros',
] as const satisfies readonly BudgetDimension[];

function requirePositiveAvailable(view: CompleteRunBudgetView, dimension: BudgetDimension): number {
  const available = budgetAvailable(view[dimension]);
  if (!Number.isFinite(available) || available <= 0) {
    throw new WorkflowError('model_budget_exhausted', `model budget exhausted for ${dimension}`, false);
  }
  return available;
}

/**
 * Builds the maximum resource envelope the host is willing to grant for one
 * model call. The store still performs the authoritative atomic reservation;
 * this helper only derives a request from an advisory snapshot.
 */
export function buildModelCallEnvelopeItems(
  view: CompleteRunBudgetView,
): ReserveBudgetEnvelopeInput['items'] {
  const turns = requirePositiveAvailable(view, 'turns');
  if (turns < 1) {
    throw new WorkflowError('model_budget_exhausted', 'model turn budget exhausted', false);
  }

  return [
    { dimension: 'turns', amount: 1 },
    { dimension: 'model_input_tokens', amount: requirePositiveAvailable(view, 'model_input_tokens') },
    { dimension: 'model_output_tokens', amount: requirePositiveAvailable(view, 'model_output_tokens') },
    { dimension: 'model_cost_micros', amount: requirePositiveAvailable(view, 'model_cost_micros') },
  ];
}

function modelGrant(envelope: BudgetEnvelopeRecord, dimension: BudgetDimension): number {
  if (envelope.kind !== 'model-call' || envelope.status !== 'reserved') {
    throw new WorkflowError('budget_envelope_invalid', 'model call limits require a reserved model-call envelope', false);
  }
  const matches = envelope.items.filter((item) => item.dimension === dimension);
  if (matches.length !== 1 || !Number.isFinite(matches[0]!.reserved) || matches[0]!.reserved <= 0) {
    throw new WorkflowError('budget_envelope_invalid', `model-call envelope lacks a valid ${dimension} grant`, false);
  }
  return matches[0]!.reserved;
}

/** Host-owned finite ceilings derived only from already-granted resources. */
export function deriveModelCallLimits(
  envelope: BudgetEnvelopeRecord,
  remainingWallTimeMs: number,
): ModelCallLimits {
  if (!Number.isFinite(remainingWallTimeMs) || remainingWallTimeMs <= 0) {
    throw new WorkflowError('runtime_wall_time_exhausted', 'no active wall time remains for model call', false);
  }

  return {
    maxInputTokens: modelGrant(envelope, 'model_input_tokens'),
    maxOutputTokens: modelGrant(envelope, 'model_output_tokens'),
    maxCostMicros: modelGrant(envelope, 'model_cost_micros'),
    maxActiveDurationMs: remainingWallTimeMs,
  };
}

function authoritativeUsage(
  name: keyof ModelTurnProposal['usage'],
  value: number | undefined,
): number {
  if (value === undefined) {
    throw new WorkflowError(
      'budget_envelope_recovery_required',
      `model usage is missing authoritative ${name}`,
      false,
    );
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new WorkflowError(
      'model_limit_contract_violated',
      `model provider reported invalid ${name}: ${String(value)}`,
      false,
    );
  }
  return value;
}

/**
 * Converts authoritative provider usage to exact envelope settlement actuals.
 * Missing usage is deliberately not zero; it forces recovery semantics.
 */
export function modelUsageToEnvelopeActuals(
  envelope: BudgetEnvelopeRecord,
  usage: ModelTurnProposal['usage'],
): Partial<Record<BudgetDimension, number>> {
  const grants = new Map<BudgetDimension, number>();
  grants.set('turns', modelGrant(envelope, 'turns'));
  for (const dimension of MODEL_DIMENSIONS) grants.set(dimension, modelGrant(envelope, dimension));

  const actuals: Partial<Record<BudgetDimension, number>> = {
    turns: 1,
    model_input_tokens: authoritativeUsage('inputTokens', usage.inputTokens),
    model_output_tokens: authoritativeUsage('outputTokens', usage.outputTokens),
    model_cost_micros: authoritativeUsage('costMicros', usage.costMicros),
  };

  for (const [dimension, actual] of Object.entries(actuals) as Array<[BudgetDimension, number]>) {
    const granted = grants.get(dimension);
    if (granted === undefined || actual > granted) {
      throw new WorkflowError(
        'model_limit_contract_violated',
        `model usage ${dimension}=${actual} exceeds granted maximum ${String(granted)}`,
        false,
      );
    }
  }
  return actuals;
}
