-- ARCP D1 metadata schema (Task 5B).
-- Manifest CAS: one row per agent, compare-and-swap on manifest_version.
-- Events: append-only, event_id is globally unique (ULID), duplicates are
-- silently ignored at the SQL layer and reported as 'duplicate' by the store.

CREATE TABLE IF NOT EXISTS residence_manifests (
  agent_id TEXT PRIMARY KEY NOT NULL,
  manifest_version INTEGER NOT NULL,
  manifest_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS residence_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL,
  event_json TEXT NOT NULL,
  inserted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_residence_events_agent
  ON residence_events (agent_id, inserted_at, event_id);
