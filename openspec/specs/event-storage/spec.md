# Event Storage Specification

## Purpose
TBD


## Requirements

### Requirement: EventRepository interface

The system SHALL define an `EventRepository` interface with the operations: `insert(envelope, receivedAt) → StoredEvent`, `recent(limit) → StoredEvent[]`, `filterOptions() → FilterOptions`, and `updateHitlResponse(id, response) → StoredEvent | null`. The HTTP and broadcast layers SHALL depend on this interface only.

#### Scenario: Layered dependency

- **WHEN** any HTTP handler module is inspected
- **THEN** it imports `EventRepository` (interface) and never imports `bun:sqlite` or any concrete repository directly

### Requirement: SQLite implementation for v1

The v1 release SHALL ship a `SqliteEventRepository` backed by `bun:sqlite`. The database SHALL run with `PRAGMA journal_mode = WAL` and `PRAGMA synchronous = NORMAL` for concurrent read/write performance. The database file path SHALL be configurable via the `DB_PATH` environment variable, defaulting to `events.db` in the working directory.

#### Scenario: WAL mode active

- **WHEN** the server starts
- **THEN** a query `PRAGMA journal_mode` returns `wal`

#### Scenario: Custom database path

- **WHEN** `DB_PATH=/tmp/test.db` is set and the server starts
- **THEN** the SQLite file `/tmp/test.db` is created and used

### Requirement: Events table schema

The `events` table SHALL contain the columns: `id` (INTEGER PRIMARY KEY AUTOINCREMENT), `envelope_version` (INTEGER NOT NULL), `agent_kind` (TEXT NOT NULL), `agent_version` (TEXT NOT NULL), `source_app` (TEXT NOT NULL), `session_id` (TEXT NOT NULL), `event_type` (TEXT NOT NULL), `raw_event_type` (TEXT NOT NULL), `timestamp` (INTEGER NOT NULL), `payload` (TEXT NOT NULL), `normalized` (TEXT NULLABLE), `summary` (TEXT NULLABLE), `transcript` (TEXT NULLABLE), `transcript_ref` (TEXT NULLABLE), `human_in_the_loop` (TEXT NULLABLE), `human_in_the_loop_status` (TEXT NULLABLE). All variable-shape JSON values SHALL be stored as TEXT.

#### Scenario: Variable shapes stored as JSON-encoded text

- **WHEN** an envelope with a complex `payload` object is inserted
- **THEN** the corresponding row's `payload` column contains the `JSON.stringify`-ed string and round-trips intact on read

#### Scenario: Optional fields nullable

- **WHEN** an envelope omits `normalized`, `summary`, `transcript`, `transcript_ref`, and `human_in_the_loop`
- **THEN** the corresponding columns in the inserted row are `NULL`

### Requirement: Indexes on common query paths

The schema SHALL define indexes on `agent_kind`, `source_app`, `session_id`, `event_type`, and `timestamp` to support filter and recency queries without table scans.

#### Scenario: Recency query uses index

- **WHEN** `recent(limit)` is executed against a database of 100,000 events
- **THEN** the query plan uses the `timestamp` index (verified via `EXPLAIN QUERY PLAN`)

### Requirement: Versioned migration system

Schema changes SHALL be applied via numbered SQL files in `db/migrations/` (e.g. `0001_init.sql`, `0002_…`). The server SHALL maintain a `schema_version` table tracking applied migrations. On startup, the server SHALL apply all pending migrations in numeric order within a single transaction per file. The system SHALL NOT use rolling `ALTER TABLE` heuristics.

#### Scenario: Fresh database

- **WHEN** the server starts against an empty database file
- **THEN** all migration files are applied in order and `schema_version` contains one row per applied file

#### Scenario: Already-applied migration skipped

- **WHEN** the server starts against a database where `schema_version` already contains version 1
- **THEN** `0001_init.sql` is not re-applied and only migrations with version > 1 run

#### Scenario: Migration failure aborts startup

- **WHEN** a migration's SQL fails to execute
- **THEN** the transaction rolls back, the server logs the failure with the file name, and exits with non-zero status without serving requests

### Requirement: ANSI-friendly SQL

Migration SQL SHALL avoid SQLite-only syntax where an ANSI equivalent exists, so the same files port to Postgres with minimal edits. Where SQLite-specific syntax is required (e.g. `INTEGER PRIMARY KEY AUTOINCREMENT`), a comment in the migration SHALL note the Postgres equivalent.

#### Scenario: Comment marks dialect-specific lines

- **WHEN** a migration file uses `INTEGER PRIMARY KEY AUTOINCREMENT`
- **THEN** an adjacent SQL comment names the Postgres equivalent (e.g. `BIGSERIAL PRIMARY KEY`)
