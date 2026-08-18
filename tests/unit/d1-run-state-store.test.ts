import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { D1RunStateStore } from '@arcp/adapter-cloudflare';
import type { ApprovalGrant, ContainmentRecord, RunRecord } from '@arcp/schema';
import { DEFAULT_BOUNDED_RUN_BUDGET } from '@arcp/workflow-core';
import { createFakeD1Database } from '../helpers/fake-d1-database.js';

const migration1 = readFileSync(fileURLToPath(new URL('../../migrations/d1/0001_init.sql', import.meta.url)), 'utf-8');
const migration2 = readFileSync(fileURLToPath(new URL('../../migrations/d1/0002_phase4_runs.sql', import.meta.url)), 'utf-8');
const now = { instant_id: 'local:unverified:d1-phase4', unverified: true } as const;

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    schema: 'arcp/run/0.1', run_id: 'run:d1:1', agent_id: 'arcp:agent:d1',
    wake_id: 'wake:d1:1', wake_idempotency_key: 'wake:key:d1:1', phase: 'authorizing',
    fencing_token: 9, budget_spec: { ...DEFAULT_BOUNDED_RUN_BUDGET, max_external_actions: 1 },
    turn_index: 0, checkpoint_sequence: 0, created_at: now, updated_at: now,
    ...overrides,
  };
}

function makeStore() {
  return new D1RunStateStore(createFakeD1Database(`${migration1}\n${migration2}`));
}

describe('D1RunStateStore', () => {
  it('deduplicates one logical run by agent + wake idempotency across adapter instances', async () => {
    const db = createFakeD1Database(`${migration1}\n${migration2}`);
    const first = new D1RunStateStore(db);
    const second = new D1RunStateStore(db);
    expect(await first.createRunIfAbsent(run())).toEqual(run());
    expect(await second.createRunIfAbsent(run({ run_id: 'run:d1:other' }))).toEqual(run());
  });

  it('atomically reserves the bounded external-action budget with the durable claim', async () => {
    const store = makeStore();
    await store.createRunIfAbsent(run());
    const claimed = await store.reserveBudgetAndClaimAction({
      runId: 'run:d1:1', fencingToken: 9, executionId: 'execution:d1:1', actionId: 'action:d1:1',
      actionHash: 'sha256:d1-action-1', actionIdempotencyKey: 'action:key:d1:1', executorId: 'executor:d1',
      providerIdempotencyMode: 'none', reservationId: 'reservation:d1:1',
      budgetDimension: 'external_actions', budgetAmount: 1, claimedAt: now,
    });
    expect(claimed.lifecycle_status).toBe('claimed');

    await expect(store.reserveBudgetAndClaimAction({
      runId: 'run:d1:1', fencingToken: 9, executionId: 'execution:d1:2', actionId: 'action:d1:2',
      actionHash: 'sha256:d1-action-2', actionIdempotencyKey: 'action:key:d1:2', executorId: 'executor:d1',
      providerIdempotencyMode: 'none', reservationId: 'reservation:d1:2',
      budgetDimension: 'external_actions', budgetAmount: 1, claimedAt: now,
    })).rejects.toMatchObject({ code: 'budget_exhausted' });
    expect(await store.getActionExecution('execution:d1:2')).toBeNull();
  });

  it('persists a receipt and settles the reserved external-action budget exactly once', async () => {
    const store = makeStore();
    await store.createRunIfAbsent(run());
    await store.reserveBudgetAndClaimAction({
      runId: 'run:d1:1', fencingToken: 9, executionId: 'execution:d1:1', actionId: 'action:d1:1',
      actionHash: 'sha256:d1-action-1', actionIdempotencyKey: 'action:key:d1:1', executorId: 'executor:d1',
      providerIdempotencyMode: 'none', reservationId: 'reservation:d1:1',
      budgetDimension: 'external_actions', budgetAmount: 1, claimedAt: now,
    });
    await store.markActionExecuting('execution:d1:1', 9, now);
    await store.appendActionReceipt({
      schema: 'arcp/action-receipt/0.1', receipt_id: 'receipt:d1:1', execution_id: 'execution:d1:1',
      run_id: 'run:d1:1', action_id: 'action:d1:1', status: 'succeeded', executor_id: 'executor:d1', observed_at: now,
    });
    await store.appendActionReceipt({
      schema: 'arcp/action-receipt/0.1', receipt_id: 'receipt:d1:1', execution_id: 'execution:d1:1',
      run_id: 'run:d1:1', action_id: 'action:d1:1', status: 'succeeded', executor_id: 'executor:d1', observed_at: now,
    });
    expect(await store.getActionExecution('execution:d1:1')).toMatchObject({
      lifecycle_status: 'receipt-recorded', effect_status: 'succeeded',
    });
  });

  it('does not throw when a receipt for the same execution is appended twice with different receipt_ids (original attempt vs. reconcile), and keeps only the first', async () => {
    const store = makeStore();
    await store.createRunIfAbsent(run());
    await store.reserveBudgetAndClaimAction({
      runId: 'run:d1:1', fencingToken: 9, executionId: 'execution:d1:1', actionId: 'action:d1:1',
      actionHash: 'sha256:d1-action-1', actionIdempotencyKey: 'action:key:d1:1', executorId: 'executor:d1',
      providerIdempotencyMode: 'none', reservationId: 'reservation:d1:1',
      budgetDimension: 'external_actions', budgetAmount: 1, claimedAt: now,
    });
    await store.markActionExecuting('execution:d1:1', 9, now);
    await store.appendActionReceipt({
      schema: 'arcp/action-receipt/0.1', receipt_id: 'receipt:original', execution_id: 'execution:d1:1',
      run_id: 'run:d1:1', action_id: 'action:d1:1', status: 'succeeded', executor_id: 'executor:d1', observed_at: now,
    });

    await expect(store.appendActionReceipt({
      schema: 'arcp/action-receipt/0.1', receipt_id: 'receipt:reconciled', execution_id: 'execution:d1:1',
      run_id: 'run:d1:1', action_id: 'action:d1:1', status: 'succeeded', executor_id: 'executor:d1', observed_at: now,
    })).resolves.toBeUndefined();

    const receipts = await store.getActionReceipts('run:d1:1');
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.receipt_id).toBe('receipt:original');
  });

  it('reserves model-turn budget atomically: the ledger reflects the reservation immediately, and an over-limit reservation is rejected', async () => {
    const db = createFakeD1Database(`${migration1}\n${migration2}`);
    const store = new D1RunStateStore(db);
    await store.createRunIfAbsent(run({ budget_spec: { ...DEFAULT_BOUNDED_RUN_BUDGET, max_turns: 1 } }));

    await store.reserveModelBudget('run:d1:1', 9, { reservationId: 'reservation:turn:1', dimension: 'turns', amount: 1 });

    const ledger = await db.prepare(
      `SELECT reserved, consumed FROM arcp_run_budget_ledger WHERE run_id = ? AND dimension = 'turns'`,
    ).bind('run:d1:1').first<{ reserved: number; consumed: number }>();
    expect(ledger).toMatchObject({ reserved: 1, consumed: 0 });

    await expect(store.reserveModelBudget('run:d1:1', 9, {
      reservationId: 'reservation:turn:2', dimension: 'turns', amount: 1,
    })).rejects.toMatchObject({ code: 'budget_exhausted' });
  });

  it('settles a model-turn reservation exactly once, even if settle is called again after the status flip', async () => {
    const db = createFakeD1Database(`${migration1}\n${migration2}`);
    const store = new D1RunStateStore(db);
    await store.createRunIfAbsent(run());
    await store.reserveModelBudget('run:d1:1', 9, { reservationId: 'reservation:turn:1', dimension: 'turns', amount: 1 });

    await store.settleModelBudget('run:d1:1', 'reservation:turn:1', 1);
    await store.settleModelBudget('run:d1:1', 'reservation:turn:1', 1);

    const ledger = await db.prepare(
      `SELECT reserved, consumed FROM arcp_run_budget_ledger WHERE run_id = ? AND dimension = 'turns'`,
    ).bind('run:d1:1').first<{ reserved: number; consumed: number }>();
    expect(ledger).toMatchObject({ reserved: 0, consumed: 1 });
  });

  it('persists approvals, containments and dead letters as operational state', async () => {
    const store = makeStore();
    await store.createRunIfAbsent(run());
    await store.createApprovalRequest({
      schema: 'arcp/approval-request/0.1', approval_request_id: 'approval:d1:1', run_id: 'run:d1:1',
      action_id: 'action:d1:1', action_hash: 'sha256:a', authority_resolution_hash: 'sha256:r',
      policy_version: 1, binding_hash: 'sha256:b', required_parties: ['entity:neo'], requested_scope: ['write'],
      created_at: now, expires_at: now, status: 'pending',
    });
    const grant: ApprovalGrant = {
      schema: 'arcp/approval-grant/0.1', approval_grant_id: 'grant:d1:1', approval_request_id: 'approval:d1:1',
      approver_entity_ref: 'entity:neo', granted_scope: ['write'], granted_at: now, idempotency_key: 'grant:key:d1:1',
    };
    await store.appendApprovalGrant(grant);
    expect(await store.getApprovalGrants('approval:d1:1')).toEqual([grant]);

    const containment: ContainmentRecord = {
      schema: 'arcp/containment/0.1', containment_id: 'containment:d1:1', agent_id: 'arcp:agent:d1',
      scope: ['external-action:write'], reason: 'fixture', authority_source: 'policy-authorized',
      entered_at: now, expires_at: now, review_required: true, exit_conditions: ['review'], status: 'active',
    };
    await store.appendContainment(containment);
    expect(await store.activeContainments('arcp:agent:d1')).toEqual([containment]);

    await store.appendDeadLetter({
      schema: 'arcp/dead-letter/0.1', dead_letter_id: 'dead:d1:1', run_id: 'run:d1:1', stage: 'reconcile',
      attempts: 1, last_error_code: 'execution_unknown', effect_state: 'unknown', manual_resolution_required: true,
      created_at: now,
    });
    expect(await store.getDeadLetters('run:d1:1')).toHaveLength(1);
  });
});
