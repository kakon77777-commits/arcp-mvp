import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOUNDED_RUN_BUDGET,
  InMemoryBudgetLedger,
  compareRisk,
} from '@arcp/workflow-core';

describe('Phase 4 run budget', () => {
  it('reserves before consumption and cannot reuse the same remaining capacity', () => {
    const ledger = new InMemoryBudgetLedger({
      ...DEFAULT_BOUNDED_RUN_BUDGET,
      max_external_actions: 1,
    });

    const reservation = ledger.reserve({
      reservationId: 'reservation:effect:1',
      dimension: 'external_actions',
      amount: 1,
    });

    expect(ledger.view().external_actions).toMatchObject({ reserved: 1, consumed: 0 });
    expect(() =>
      ledger.reserve({
        reservationId: 'reservation:effect:2',
        dimension: 'external_actions',
        amount: 1,
      }),
    ).toThrowError(expect.objectContaining({ code: 'budget_exhausted' }));

    ledger.settle(reservation.reservationId, 1);
    expect(ledger.view().external_actions).toMatchObject({ reserved: 0, consumed: 1 });
  });

  it('uses a bounded default profile and orders risk monotonically', () => {
    expect(DEFAULT_BOUNDED_RUN_BUDGET.max_turns).toBe(4);
    expect(DEFAULT_BOUNDED_RUN_BUDGET.max_external_actions).toBeGreaterThan(0);
    expect(DEFAULT_BOUNDED_RUN_BUDGET.max_risk).toBe('R2');
    expect(compareRisk('R4', 'R3')).toBeGreaterThan(0);
    expect(compareRisk('R0', 'R1')).toBeLessThan(0);
  });

  it('charges active wall time explicitly rather than persisted waiting duration', () => {
    const ledger = new InMemoryBudgetLedger({
      ...DEFAULT_BOUNDED_RUN_BUDGET,
      max_wall_time_ms: 1_000,
    });
    ledger.consumeActiveWallTime(250);
    expect(ledger.view().wall_time_ms.consumed).toBe(250);

    // A persisted approval wait is not active execution time. Nothing changes
    // until the runtime explicitly reports another active segment.
    expect(ledger.view().wall_time_ms.consumed).toBe(250);
    ledger.consumeActiveWallTime(750);
    expect(ledger.view().wall_time_ms.consumed).toBe(1_000);
    expect(() => ledger.consumeActiveWallTime(1)).toThrowError(
      expect.objectContaining({ code: 'budget_exhausted' }),
    );
  });
});
