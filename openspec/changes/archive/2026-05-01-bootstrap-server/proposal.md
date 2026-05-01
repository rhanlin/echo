## Why

Multiple AI coding agents (Claude Code, Gemini CLI, Codex, Cursor, …) emit lifecycle events during execution, but each uses its own hook/extension format. We need a single backend that ingests, persists, and broadcasts these events in a normalized form so a Dashboard (built later) can monitor any agent the same way.

Prior art in this space typically hard-codes a single agent's vocabulary into the wire format, couples the server to non-core domains (themes, ratings, sharing, TTS), and uses runtime `ALTER TABLE` heuristics for schema evolution. We will instead build the backend with a clean envelope contract, an agent-agnostic server, and module boundaries (`EventRepository`, `Broadcaster`) that allow future migration to Postgres + Redis Pub/Sub without rewriting upper layers.

## What Changes

- **NEW**: A unified `EventEnvelope` v1 contract (snake_case JSON) carrying `agent_kind`, `agent_version`, `source_app`, `session_id`, `event_type` (normalized), `raw_event_type`, `payload`, optional `normalized` / `summary` / `transcript` / `human_in_the_loop`.
- **NEW**: A `CANONICAL_EVENT_TYPES` vocabulary (`session.start/end`, `user.prompt.submit`, `tool.pre_use/post_use/failure`, `agent.notification/stop/precompact`, `subagent.start/stop`, `unknown`). Adapters SHOULD map to this list but server treats it as a hint, not a constraint.
- **NEW**: Bun + TypeScript server with HTTP endpoints (`POST /events`, `GET /events/recent`, `GET /events/filter-options`, `POST /events/:id/respond`) and a WebSocket `/stream` (initial snapshot + live broadcast).
- **NEW**: `EventRepository` interface with a SQLite implementation (WAL, JSON-as-TEXT for variable shape) and `Broadcaster` interface with an in-memory implementation. Postgres / Redis implementations explicitly out of scope.
- **NEW**: Versioned SQL migrations (`db/migrations/0001_init.sql`, …) tracked in a `schema_version` table. No rolling `ALTER` heuristics.
- **NEW**: HTTP routing via Hono (router + CORS middleware only). WebSocket upgrade via Bun native server.
- **NEW**: Human-in-the-loop is an optional envelope property, not a separate event type. `callback` supports `websocket` or `webhook` (no `none` — pure notifications use `event_type: agent.notification`).
- **NEW**: Adapter development guide + JSON Schema published as the contract; `claude-code` adapter implementation deferred to a follow-up change.
- **REMOVED** (compared to typical prior art in this space): theme CRUD, theme sharing, theme ratings, TTS notifications, frontend.

## Capabilities

### New Capabilities

- `event-envelope`: The wire contract every adapter must produce — top-level fields, normalized event type vocabulary, validation rules, versioning policy.
- `event-ingestion`: HTTP intake of envelopes, validation, persistence, and broadcast fan-out. Includes filter options endpoint and recent-events query.
- `event-broadcast`: WebSocket subscription stream — initial snapshot on connect, live event push, dead-connection cleanup. Defines the `Broadcaster` interface.
- `event-storage`: Append-only event log with `EventRepository` interface, SQLite implementation, indexed columns, and versioned migration system.
- `human-in-the-loop`: Optional HITL envelope property, response endpoint, status tracking, and callback delivery (websocket / webhook) back to the requesting agent.

### Modified Capabilities

(none — fresh repository)

## Impact

- **Repository**: New `apps/server/` (Bun + TS), `packages/envelope/` (shared types + JSON Schema + canonical vocabulary), `db/migrations/`. No frontend.
- **Dependencies**: `bun` runtime, `hono` (router only), `bun:sqlite` (built-in). No ORM, no validation framework beyond manual + JSON Schema reference.
- **Configuration**: Env vars `SERVER_PORT`, `DB_PATH`, `CORS_ORIGINS` (CSV; default `*` for local dev). No auth in v1.
- **Out of scope (deliberate)**: Postgres impl, Redis Pub/Sub, auth, message queue, Dockerfile, multi-replica deployment, frontend UI, claude-code adapter (separate change).
- **Future migration markers** documented in code comments and README: which interface boundaries to swap for cloud (`EventRepository` → Postgres, `Broadcaster` → Redis, add auth middleware).
