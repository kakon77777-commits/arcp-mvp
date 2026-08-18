-- Phase 4 operational bounded-run state.
-- Mutable orchestration state is separate from the append-only Residence event log.

CREATE TABLE IF NOT EXISTS arcp_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL,
  wake_idempotency_key TEXT NOT NULL,
  fencing_token INTEGER NOT NULL,
  phase TEXT NOT NULL,
  run_json TEXT NOT NULL,
  UNIQUE (agent_id, wake_idempotency_key)
);

CREATE TABLE IF NOT EXISTS arcp_run_checkpoints (
  checkpoint_id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  checkpoint_json TEXT NOT NULL,
  UNIQUE (run_id, sequence)
);

CREATE TABLE IF NOT EXISTS arcp_run_budget_ledger (
  run_id TEXT NOT NULL,
  dimension TEXT NOT NULL,
  limit_value INTEGER NOT NULL,
  reserved INTEGER NOT NULL DEFAULT 0,
  consumed INTEGER NOT NULL DEFAULT 0,
  released INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, dimension)
);

CREATE TABLE IF NOT EXISTS arcp_model_budget_reservations (
  reservation_id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  dimension TEXT NOT NULL,
  amount INTEGER NOT NULL,
  actual_amount INTEGER,
  status TEXT NOT NULL CHECK (status IN ('reserved','settled','released'))
);

CREATE TABLE IF NOT EXISTS arcp_model_invocations (
  invocation_id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  invocation_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS arcp_authority_resolutions (
  resolution_id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  resolution_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS arcp_approval_requests (
  approval_request_id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  request_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS arcp_approval_grants (
  approval_grant_id TEXT PRIMARY KEY NOT NULL,
  approval_request_id TEXT NOT NULL,
  approver_entity_ref TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  grant_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS arcp_action_executions (
  execution_id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  action_hash TEXT NOT NULL,
  action_idempotency_key TEXT NOT NULL,
  fencing_token INTEGER NOT NULL,
  lifecycle_status TEXT NOT NULL,
  effect_status TEXT NOT NULL,
  reconciliation_status TEXT NOT NULL,
  budget_reservation_id TEXT NOT NULL UNIQUE,
  budget_dimension TEXT NOT NULL,
  budget_amount INTEGER NOT NULL,
  execution_json TEXT NOT NULL,
  UNIQUE (run_id, action_idempotency_key)
);

CREATE TABLE IF NOT EXISTS arcp_action_receipts (
  receipt_id TEXT PRIMARY KEY NOT NULL,
  execution_id TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL,
  receipt_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS arcp_containments (
  containment_id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL,
  containment_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS arcp_dead_letters (
  dead_letter_id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  dead_letter_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_arcp_runs_agent ON arcp_runs (agent_id, phase);
CREATE INDEX IF NOT EXISTS idx_arcp_checkpoints_run ON arcp_run_checkpoints (run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_arcp_authority_run ON arcp_authority_resolutions (run_id);
CREATE INDEX IF NOT EXISTS idx_arcp_grants_request ON arcp_approval_grants (approval_request_id);
CREATE INDEX IF NOT EXISTS idx_arcp_executions_run ON arcp_action_executions (run_id, lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_arcp_receipts_run ON arcp_action_receipts (run_id);
CREATE INDEX IF NOT EXISTS idx_arcp_containments_agent ON arcp_containments (agent_id, status);
CREATE INDEX IF NOT EXISTS idx_arcp_dead_letters_run ON arcp_dead_letters (run_id);

-- One INSERT into arcp_action_executions is the external-effect preclaim
-- boundary. These triggers make budget reservation + claim one SQLite atomic
-- statement: any RAISE aborts both the INSERT and trigger changes.
CREATE TRIGGER IF NOT EXISTS arcp_action_claim_budget_guard
BEFORE INSERT ON arcp_action_executions
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM arcp_run_budget_ledger
       WHERE run_id = NEW.run_id AND dimension = NEW.budget_dimension
    ) THEN RAISE(ABORT, 'ARCP_BUDGET_DIMENSION_MISSING')
    WHEN (
      SELECT consumed + reserved + NEW.budget_amount > limit_value
        FROM arcp_run_budget_ledger
       WHERE run_id = NEW.run_id AND dimension = NEW.budget_dimension
    ) THEN RAISE(ABORT, 'ARCP_BUDGET_EXHAUSTED')
  END;
END;

CREATE TRIGGER IF NOT EXISTS arcp_action_claim_budget_reserve
AFTER INSERT ON arcp_action_executions
BEGIN
  UPDATE arcp_run_budget_ledger
     SET reserved = reserved + NEW.budget_amount
   WHERE run_id = NEW.run_id AND dimension = NEW.budget_dimension;
END;

-- At most one receipt row exists for one execution in the Phase 4 MVP. A
-- later reconciliation changes execution reconciliation metadata but does not
-- settle the same reservation twice.
CREATE TRIGGER IF NOT EXISTS arcp_action_receipt_budget_settle
AFTER INSERT ON arcp_action_receipts
BEGIN
  UPDATE arcp_run_budget_ledger
     SET reserved = reserved - (
           SELECT budget_amount FROM arcp_action_executions WHERE execution_id = NEW.execution_id
         ),
         consumed = consumed + (
           SELECT budget_amount FROM arcp_action_executions WHERE execution_id = NEW.execution_id
         )
   WHERE run_id = NEW.run_id
     AND dimension = (
       SELECT budget_dimension FROM arcp_action_executions WHERE execution_id = NEW.execution_id
     );
END;

-- The receipt INSERT is also the sole atomic boundary for recording that a
-- receipt now exists: lifecycle/effect/reconciliation status move together
-- with the receipt row in the same statement, so a crash between "receipt
-- persisted" and "execution marked receipt-recorded" cannot happen.
CREATE TRIGGER IF NOT EXISTS arcp_action_receipt_lifecycle_update
AFTER INSERT ON arcp_action_receipts
BEGIN
  UPDATE arcp_action_executions
     SET lifecycle_status = 'receipt-recorded',
         effect_status = json_extract(NEW.receipt_json, '$.status'),
         reconciliation_status = CASE
           WHEN json_extract(NEW.receipt_json, '$.status') = 'unknown' THEN 'pending'
           ELSE 'not-required'
         END
   WHERE execution_id = NEW.execution_id;
END;

-- Model-turn budget reservations follow the same one-INSERT-is-the-atomic-
-- boundary pattern as the external-action claim above, instead of the
-- separate SELECT-then-UPDATE round trips that previously left a crash
-- window between "reservation row written" and "ledger incremented".
CREATE TRIGGER IF NOT EXISTS arcp_model_budget_reservation_guard
BEFORE INSERT ON arcp_model_budget_reservations
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM arcp_run_budget_ledger
       WHERE run_id = NEW.run_id AND dimension = NEW.dimension
    ) THEN RAISE(ABORT, 'ARCP_BUDGET_DIMENSION_MISSING')
    WHEN (
      SELECT consumed + reserved + NEW.amount > limit_value
        FROM arcp_run_budget_ledger
       WHERE run_id = NEW.run_id AND dimension = NEW.dimension
    ) THEN RAISE(ABORT, 'ARCP_BUDGET_EXHAUSTED')
  END;
END;

CREATE TRIGGER IF NOT EXISTS arcp_model_budget_reservation_reserve
AFTER INSERT ON arcp_model_budget_reservations
BEGIN
  UPDATE arcp_run_budget_ledger
     SET reserved = reserved + NEW.amount
   WHERE run_id = NEW.run_id AND dimension = NEW.dimension;
END;

-- Settling a model-turn reservation is guarded the same way: the single
-- status-flip UPDATE (WHERE status='reserved') is the atomic boundary, and
-- the ledger delta only applies via the trigger when that flip actually took
-- effect -- a crash before the flip leaves the reservation untouched
-- (retryable), and a concurrent/duplicate settle attempt after the flip is a
-- harmless no-op instead of double-subtracting from the ledger.
CREATE TRIGGER IF NOT EXISTS arcp_model_budget_reservation_settle
AFTER UPDATE OF status ON arcp_model_budget_reservations
WHEN NEW.status = 'settled' AND OLD.status = 'reserved'
BEGIN
  UPDATE arcp_run_budget_ledger
     SET reserved = reserved - NEW.amount,
         consumed = consumed + NEW.actual_amount,
         released = released + (NEW.amount - NEW.actual_amount)
   WHERE run_id = NEW.run_id AND dimension = NEW.dimension;
END;
