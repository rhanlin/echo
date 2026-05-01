-- 0001_init.sql
-- Initial schema for the echo event log.
--
-- Notes for future Postgres port:
--   * `INTEGER PRIMARY KEY AUTOINCREMENT`  ->  `BIGSERIAL PRIMARY KEY`
--   * Variable-shape JSON stored as TEXT   ->  use `JSONB` columns
--   * No SQLite-only functions used elsewhere

CREATE TABLE IF NOT EXISTS events (
  -- Postgres equivalent: BIGSERIAL PRIMARY KEY
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  envelope_version INTEGER NOT NULL,
  agent_kind       TEXT    NOT NULL,
  agent_version    TEXT    NOT NULL,
  source_app       TEXT    NOT NULL,
  session_id       TEXT    NOT NULL,
  event_type       TEXT    NOT NULL,
  raw_event_type   TEXT    NOT NULL,
  timestamp        INTEGER NOT NULL,

  -- Variable-shape JSON columns (TEXT in SQLite, JSONB in Postgres).
  payload                  TEXT NOT NULL,
  normalized               TEXT,
  summary                  TEXT,
  transcript               TEXT,
  transcript_ref           TEXT,
  human_in_the_loop        TEXT,
  human_in_the_loop_status TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_agent_kind  ON events(agent_kind);
CREATE INDEX IF NOT EXISTS idx_events_source_app  ON events(source_app);
CREATE INDEX IF NOT EXISTS idx_events_session_id  ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_event_type  ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_timestamp   ON events(timestamp);

CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
