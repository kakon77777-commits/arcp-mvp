-- Phase 5.0A: crash-safe multi-dimensional budget envelopes and model-call lifecycle support.
-- Existing Phase 4 reservation tables remain intact/readable for compatibility.

CREATE TABLE IF NOT EXISTS arcp_budget_envelopes (
  envelope_id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved','settled','released','recovery-required')),
  items_json TEXT NOT NULL,
  actuals_json TEXT,
  envelope_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_arcp_budget_envelopes_run
  ON arcp_budget_envelopes (run_id, status);

-- Durable model invocation lifecycle CAS. Old rows are backfilled from their
-- Phase 4 JSON so they remain readable after migration.
ALTER TABLE arcp_model_invocations ADD COLUMN status TEXT;
ALTER TABLE arcp_model_invocations ADD COLUMN budget_envelope_id TEXT;
UPDATE arcp_model_invocations
SET status = COALESCE(status, json_extract(invocation_json, '$.status'));

-- One INSERT is the all-or-nothing envelope reservation boundary.
CREATE TRIGGER IF NOT EXISTS arcp_budget_envelope_reserve_guard
BEFORE INSERT ON arcp_budget_envelopes
BEGIN
  SELECT CASE
    WHEN json_valid(NEW.items_json) = 0
      OR json_type(NEW.items_json) != 'array'
      OR json_array_length(NEW.items_json) = 0
      THEN RAISE(ABORT, 'ARCP_ENVELOPE_INVALID')
    WHEN NOT EXISTS (
      SELECT 1 FROM arcp_runs
       WHERE run_id = NEW.run_id AND fencing_token = NEW.fencing_token
    ) THEN RAISE(ABORT, 'ARCP_STALE_FENCING')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.items_json) AS item
       WHERE json_type(item.value, '$.dimension') != 'text'
          OR json_type(item.value, '$.reserved') NOT IN ('integer','real')
          OR CAST(json_extract(item.value, '$.reserved') AS REAL) <= 0
    ) THEN RAISE(ABORT, 'ARCP_ENVELOPE_INVALID')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.items_json) AS item
       WHERE json_extract(item.value, '$.dimension') NOT IN (
        'turns','wall_time_ms','model_input_tokens','model_output_tokens','model_cost_micros',
        'tool_calls','external_actions','storage_writes','network_requests','recursive_wakes'
       )
    ) THEN RAISE(ABORT, 'ARCP_ENVELOPE_INVALID')
    WHEN (
      SELECT COUNT(*) FROM json_each(NEW.items_json)
    ) != (
      SELECT COUNT(DISTINCT json_extract(item.value, '$.dimension'))
        FROM json_each(NEW.items_json) AS item
    ) THEN RAISE(ABORT, 'ARCP_ENVELOPE_INVALID')
    WHEN EXISTS (
      SELECT 1
        FROM json_each(NEW.items_json) AS item
        LEFT JOIN arcp_run_budget_ledger AS ledger
          ON ledger.run_id = NEW.run_id
         AND ledger.dimension = json_extract(item.value, '$.dimension')
       WHERE ledger.dimension IS NULL
    ) THEN RAISE(ABORT, 'ARCP_BUDGET_DIMENSION_MISSING')
    WHEN EXISTS (
      SELECT 1
        FROM json_each(NEW.items_json) AS item
        JOIN arcp_run_budget_ledger AS ledger
          ON ledger.run_id = NEW.run_id
         AND ledger.dimension = json_extract(item.value, '$.dimension')
       WHERE ledger.consumed + ledger.reserved + CAST(json_extract(item.value, '$.reserved') AS REAL)
             > ledger.limit_value
    ) THEN RAISE(ABORT, 'ARCP_BUDGET_EXHAUSTED')
  END;
END;

CREATE TRIGGER IF NOT EXISTS arcp_budget_envelope_reserve_apply
AFTER INSERT ON arcp_budget_envelopes
BEGIN
  UPDATE arcp_run_budget_ledger
     SET reserved = reserved + COALESCE((
       SELECT CAST(json_extract(item.value, '$.reserved') AS REAL)
         FROM json_each(NEW.items_json) AS item
        WHERE json_extract(item.value, '$.dimension') = arcp_run_budget_ledger.dimension
     ), 0)
   WHERE run_id = NEW.run_id
     AND dimension IN (
       SELECT json_extract(item.value, '$.dimension') FROM json_each(NEW.items_json) AS item
     );
END;

-- Normal or conservative recovery settlement requires exactly one valid actual
-- for every held dimension. recovery-required remains held until this update.
CREATE TRIGGER IF NOT EXISTS arcp_budget_envelope_settle_guard
BEFORE UPDATE OF status ON arcp_budget_envelopes
WHEN OLD.status IN ('reserved','recovery-required') AND NEW.status = 'settled'
BEGIN
  SELECT CASE
    WHEN NEW.actuals_json IS NULL
      OR json_valid(NEW.actuals_json) = 0
      OR json_type(NEW.actuals_json) != 'array'
      OR json_array_length(NEW.actuals_json) != json_array_length(OLD.items_json)
      THEN RAISE(ABORT, 'ARCP_ENVELOPE_INVALID')
    WHEN (
      SELECT COUNT(DISTINCT json_extract(actual.value, '$.dimension'))
        FROM json_each(NEW.actuals_json) AS actual
    ) != json_array_length(OLD.items_json)
      THEN RAISE(ABORT, 'ARCP_ENVELOPE_INVALID')
    WHEN EXISTS (
      SELECT 1 FROM json_each(OLD.items_json) AS item
       WHERE NOT EXISTS (
         SELECT 1 FROM json_each(NEW.actuals_json) AS actual
          WHERE json_extract(actual.value, '$.dimension') = json_extract(item.value, '$.dimension')
       )
    ) THEN RAISE(ABORT, 'ARCP_ENVELOPE_INVALID')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.actuals_json) AS actual
       WHERE NOT EXISTS (
         SELECT 1 FROM json_each(OLD.items_json) AS item
          WHERE json_extract(item.value, '$.dimension') = json_extract(actual.value, '$.dimension')
       )
    ) THEN RAISE(ABORT, 'ARCP_ENVELOPE_INVALID')
    WHEN EXISTS (
      SELECT 1
        FROM json_each(NEW.actuals_json) AS actual
        JOIN json_each(OLD.items_json) AS item
          ON json_extract(item.value, '$.dimension') = json_extract(actual.value, '$.dimension')
       WHERE json_type(actual.value, '$.actual') NOT IN ('integer','real')
          OR CAST(json_extract(actual.value, '$.actual') AS REAL) < 0
          OR CAST(json_extract(actual.value, '$.actual') AS REAL)
             > CAST(json_extract(item.value, '$.reserved') AS REAL)
    ) THEN RAISE(ABORT, 'ARCP_ENVELOPE_INVALID')
  END;
END;

CREATE TRIGGER IF NOT EXISTS arcp_budget_envelope_settle_apply
AFTER UPDATE OF status ON arcp_budget_envelopes
WHEN OLD.status IN ('reserved','recovery-required') AND NEW.status = 'settled'
BEGIN
  UPDATE arcp_run_budget_ledger
     SET reserved = reserved - (
           SELECT CAST(json_extract(item.value, '$.reserved') AS REAL)
             FROM json_each(OLD.items_json) AS item
            WHERE json_extract(item.value, '$.dimension') = arcp_run_budget_ledger.dimension
         ),
         consumed = consumed + (
           SELECT CAST(json_extract(actual.value, '$.actual') AS REAL)
             FROM json_each(NEW.actuals_json) AS actual
            WHERE json_extract(actual.value, '$.dimension') = arcp_run_budget_ledger.dimension
         ),
         released = released + (
           SELECT CAST(json_extract(item.value, '$.reserved') AS REAL)
             FROM json_each(OLD.items_json) AS item
            WHERE json_extract(item.value, '$.dimension') = arcp_run_budget_ledger.dimension
         ) - (
           SELECT CAST(json_extract(actual.value, '$.actual') AS REAL)
             FROM json_each(NEW.actuals_json) AS actual
            WHERE json_extract(actual.value, '$.dimension') = arcp_run_budget_ledger.dimension
         )
   WHERE run_id = OLD.run_id
     AND dimension IN (
       SELECT json_extract(item.value, '$.dimension') FROM json_each(OLD.items_json) AS item
     );
END;

CREATE TRIGGER IF NOT EXISTS arcp_budget_envelope_release_apply
AFTER UPDATE OF status ON arcp_budget_envelopes
WHEN OLD.status = 'reserved' AND NEW.status = 'released'
BEGIN
  UPDATE arcp_run_budget_ledger
     SET reserved = reserved - (
           SELECT CAST(json_extract(item.value, '$.reserved') AS REAL)
             FROM json_each(OLD.items_json) AS item
            WHERE json_extract(item.value, '$.dimension') = arcp_run_budget_ledger.dimension
         ),
         released = released + (
           SELECT CAST(json_extract(item.value, '$.reserved') AS REAL)
             FROM json_each(OLD.items_json) AS item
            WHERE json_extract(item.value, '$.dimension') = arcp_run_budget_ledger.dimension
         )
   WHERE run_id = OLD.run_id
     AND dimension IN (
       SELECT json_extract(item.value, '$.dimension') FROM json_each(OLD.items_json) AS item
     );
END;

-- reserved -> recovery-required intentionally has no ledger trigger: the
-- reservation remains held until later reconciliation decides what was used.