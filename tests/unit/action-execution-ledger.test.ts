import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOUNDED_RUN_BUDGET,
  InMemoryRunStateStore,
  recoverExecutionDecision,
} from '@arcp/workflow-core';
import type { RunRecord } from '@arcp/schema';

const now = { instant_id: 'local:unverified:test', unverified: true } as const;

function run(): RunRecord {
  return {
    schema: 'arcp/run/0.1',
    run_id: 'run:1',
    agent_id: 'arcp:agent:test',
    wake_id: 'wake:1',
    wake_idempotency_key: 'wake:key:1',
    phase: 'authorizing',
    fencing_token: 7,
    budget_spec: DEFAULT_BOUNDED_RUN_BUDGET,
    turn_index: 0,
    checkpoint_sequence: 0,
    created_at: now,
    updated_at: now,
  };
}

describe('Phase 4 action execution ledger', () => {
  it('atomically reserves budget and claims before execution', async () => {
    const store = new InMemoryRunStateStore();
    await store.createRunIfAbsent(run());

    const claimed = await store.reserveBudgetAndClaimAction({
      runId: 'run:1',
      fencingToken: 7,
      executionId: 'execution:1',
      actionId: 'action:1',
      actionHash: 'sha256:action-1',
      actionIdempotencyKey: 'action:key:1',
      executorId: 'executor:test',
      providerIdempotencyMode: 'none',
      providerIdempotencyKey: undefined,
      reservationId: 'reservation:1',
      budgetDimension: 'external_actions',
      budgetAmount: 1,
      claimedAt: now,
    });

    expect(claimed.lifecycle_status).toBe('claimed');
    expect(claimed.effect_status).toBe('not-observed');
    expect(claimed.reconciliation_status).toBe('not-required');

    const executing = await store.markActionExecuting('execution:1', 7, now);
    expect(executing.lifecycle_status).toBe('executing');
    expect(recoverExecutionDecision(executing)).toBe('reconcile');
  });

  it('distinguishes provider-enforced retry from unsafe blind retry', async () => {
    const store = new InMemoryRunStateStore();
    await store.createRunIfAbsent(run());

    const claimed = await store.reserveBudgetAndClaimAction({
      runId: 'run:1',
      fencingToken: 7,
      executionId: 'execution:provider-idempotent',
      actionId: 'action:2',
      actionHash: 'sha256:action-2',
      actionIdempotencyKey: 'action:key:2',
      executorId: 'executor:test',
      providerIdempotencyMode: 'provider-enforced',
      providerIdempotencyKey: 'provider:key:2',
      reservationId: 'reservation:2',
      budgetDimension: 'external_actions',
      budgetAmount: 1,
      claimedAt: now,
    });
    const executing = await store.markActionExecuting(claimed.execution_id, 7, now);
    expect(recoverExecutionDecision(executing)).toBe('safe-provider-retry-or-reconcile');
  });

  it('moves receipt-recorded executions to commit-only recovery', async () => {
    const store = new InMemoryRunStateStore();
    await store.createRunIfAbsent(run());
    await store.reserveBudgetAndClaimAction({
      runId: 'run:1', fencingToken: 7, executionId: 'execution:3', actionId: 'action:3',
      actionHash: 'sha256:action-3', actionIdempotencyKey: 'action:key:3', executorId: 'executor:test',
      providerIdempotencyMode: 'none', reservationId: 'reservation:3',
      budgetDimension: 'external_actions', budgetAmount: 1, claimedAt: now,
    });
    await store.markActionExecuting('execution:3', 7, now);
    await store.appendActionReceipt({
      schema: 'arcp/action-receipt/0.1',
      receipt_id: 'receipt:3', execution_id: 'execution:3', run_id: 'run:1', action_id: 'action:3',
      status: 'succeeded', executor_id: 'executor:test', observed_at: now,
    });
    const execution = await store.getActionExecution('execution:3');
    expect(execution?.lifecycle_status).toBe('receipt-recorded');
    expect(execution?.effect_status).toBe('succeeded');
    expect(recoverExecutionDecision(execution!)).toBe('commit-only');
  });
});
