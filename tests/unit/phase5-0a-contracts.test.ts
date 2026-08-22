import { describe, expect, it } from 'vitest';
import {
  budgetAvailable,
  type CompleteRunBudgetView,
  type MonotonicClockPort,
  type ProvenanceClockPort,
} from '@arcp/workflow-core';

describe('Phase 5.0A foundation contracts', () => {
  it('models all ten dimensions in an authoritative budget view', () => {
    const view: CompleteRunBudgetView = {
      turns: { limit: 4, reserved: 0, consumed: 0, released: 0 },
      wall_time_ms: { limit: 120_000, reserved: 0, consumed: 0, released: 0 },
      model_input_tokens: { limit: 64_000, reserved: 0, consumed: 0, released: 0 },
      model_output_tokens: { limit: 16_000, reserved: 0, consumed: 0, released: 0 },
      model_cost_micros: { limit: 1_000_000, reserved: 0, consumed: 0, released: 0 },
      tool_calls: { limit: 12, reserved: 0, consumed: 0, released: 0 },
      external_actions: { limit: 8, reserved: 0, consumed: 0, released: 0 },
      storage_writes: { limit: 8, reserved: 0, consumed: 0, released: 0 },
      network_requests: { limit: 16, reserved: 0, consumed: 0, released: 0 },
      recursive_wakes: { limit: 2, reserved: 0, consumed: 0, released: 0 },
    };

    expect(Object.keys(view)).toHaveLength(10);
    expect(budgetAvailable(view.model_output_tokens)).toBe(16_000);
  });

  it('keeps provenance and monotonic clocks distinct', () => {
    const provenance: ProvenanceClockPort = {
      now: () => ({ instant_id: 'local:test', unverified: true }),
    };
    const monotonic: MonotonicClockPort = { nowMs: () => 42 };

    expect(provenance.now().instant_id).toBe('local:test');
    expect(monotonic.nowMs()).toBe(42);
  });
});
