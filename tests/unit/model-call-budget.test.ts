import { describe, expect, it } from 'vitest';
import type { BudgetEnvelopeRecord } from '@arcp/schema';
import {
  buildModelCallEnvelopeItems,
  deriveModelCallLimits,
  modelUsageToEnvelopeActuals,
  type CompleteRunBudgetView,
} from '@arcp/workflow-core';

const now = { instant_id: 'local:unverified:model-budget', unverified: true } as const;

function view(overrides: Partial<CompleteRunBudgetView> = {}): CompleteRunBudgetView {
  return {
    turns: { limit: 4, reserved: 2, consumed: 1, released: 0 },
    wall_time_ms: { limit: 120_000, reserved: 0, consumed: 1000, released: 0 },
    model_input_tokens: { limit: 10_000, reserved: 2000, consumed: 3000, released: 0 },
    model_output_tokens: { limit: 4000, reserved: 1000, consumed: 2000, released: 0 },
    model_cost_micros: { limit: 100_000, reserved: 30_000, consumed: 50_000, released: 0 },
    tool_calls: { limit: 12, reserved: 0, consumed: 0, released: 0 },
    external_actions: { limit: 8, reserved: 0, consumed: 0, released: 0 },
    storage_writes: { limit: 8, reserved: 0, consumed: 0, released: 0 },
    network_requests: { limit: 16, reserved: 0, consumed: 0, released: 0 },
    recursive_wakes: { limit: 2, reserved: 0, consumed: 0, released: 0 },
    ...overrides,
  };
}

function envelope(): BudgetEnvelopeRecord {
  return {
    schema: 'arcp/budget-envelope/0.1',
    envelope_id: 'envelope:model:1',
    run_id: 'run:model:1',
    fencing_token: 3,
    kind: 'model-call',
    status: 'reserved',
    items: [
      { dimension: 'turns', reserved: 1 },
      { dimension: 'model_input_tokens', reserved: 5000 },
      { dimension: 'model_output_tokens', reserved: 1000 },
      { dimension: 'model_cost_micros', reserved: 20_000 },
    ],
    reserved_at: now,
  };
}

describe('Phase 5.0A host-owned model budget planning', () => {
  it('reserves the currently available model maxima plus exactly one turn', () => {
    expect(buildModelCallEnvelopeItems(view())).toEqual([
      { dimension: 'turns', amount: 1 },
      { dimension: 'model_input_tokens', amount: 5000 },
      { dimension: 'model_output_tokens', amount: 1000 },
      { dimension: 'model_cost_micros', amount: 20_000 },
    ]);
  });

  it('fails closed when any required model dimension has zero availability', () => {
    const zeroOutput = view({
      model_output_tokens: { limit: 3000, reserved: 1000, consumed: 2000, released: 0 },
    });
    expect(() => buildModelCallEnvelopeItems(zeroOutput))
      .toThrow(expect.objectContaining({ code: 'model_budget_exhausted' }));
  });

  it('derives finite call limits no larger than the durable grant', () => {
    expect(deriveModelCallLimits(envelope(), 8400)).toEqual({
      maxInputTokens: 5000,
      maxOutputTokens: 1000,
      maxCostMicros: 20_000,
      maxActiveDurationMs: 8400,
    });
  });

  it('requires authoritative actuals and rejects provider-reported overspend', () => {
    expect(modelUsageToEnvelopeActuals(envelope(), {
      inputTokens: 123,
      outputTokens: 237,
      costMicros: 456,
    })).toEqual({
      turns: 1,
      model_input_tokens: 123,
      model_output_tokens: 237,
      model_cost_micros: 456,
    });

    expect(() => modelUsageToEnvelopeActuals(envelope(), {
      inputTokens: 123,
      costMicros: 456,
    })).toThrow(expect.objectContaining({ code: 'budget_envelope_recovery_required' }));

    expect(() => modelUsageToEnvelopeActuals(envelope(), {
      inputTokens: 123,
      outputTokens: 1001,
      costMicros: 456,
    })).toThrow(expect.objectContaining({ code: 'model_limit_contract_violated' }));
  });
});
