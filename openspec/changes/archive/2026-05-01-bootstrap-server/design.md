## Context

Prior art for multi-agent observability typically ships useful primitives — a Bun + SQLite single-file server, a hook-based event sender, an in-memory WebSocket fan-out, and a HITL flow — but bakes a single agent's semantics into the wire format (e.g. a field literally named `hook_event_type`), couples the server to non-core domains (themes, ratings, sharing, TTS), and uses runtime `ALTER TABLE` heuristics for schema evolution.

We are building a fresh backend (codename **echo**) that:

- Runs locally as a single Bun process with zero external dependencies.
- Treats the wire format as a versioned contract owned by the server, not by any individual agent.
- Cleanly separates the persistence layer (`EventRepository`) and the fan-out layer (`Broadcaster`) so future cloud deployment (Postgres + Redis Pub/Sub) is a localized change.
- Excludes non-core features (themes, ratings, sharing, TTS) entirely.

Constraints:

- Single developer / small team usage initially, single-machine.
- We commit to "extreme minimalism short term, no lock-in long term" as the design principle. Every "future-proofing" decision must be cheap *now*; otherwise we defer it.
- TypeScript + Bun runtime is fixed (chosen for Bun's first-class SQLite and zero-config WebSocket support).

Stakeholders: project owner (sole developer), future adapter authors who must be able to ship a new agent integration without changing the server.

## Goals / Non-Goals

**Goals:**

- Define `EventEnvelope` v1 as the single source of truth, expressed as both TypeScript types and a JSON Schema document.
- Stand up an HTTP + WebSocket server that accepts envelopes, persists them, and broadcasts to subscribers — with no agent-specific code paths.
- Establish `EventRepository` and `Broadcaster` as interfaces with thin SQLite / in-memory implementations behind them.
- Use versioned SQL migrations from day one.
- Use Hono only as a router (plus its CORS middleware); no framework lock-in beyond a thin handler signature.
- Provide a CONTRIBUTING-style adapter development guide so the next person writing a Gemini / Codex / Cursor adapter has a clear contract.

**Non-Goals:**

- Building any frontend or dashboard UI.
- Implementing the claude-code adapter (separate follow-up change).
- Authentication, rate limiting, multi-tenant isolation.
- Postgres, Redis, message queues, Docker images, Kubernetes manifests.
- Theme management, sharing, ratings, TTS — explicitly removed from scope.
- Down-migrations, schema rollback tooling.
- Auto-generating the JSON Schema from TypeScript types (we hand-write both and keep them in sync via a checked-in test).

## Decisions

### D1. Envelope is the wire contract, server speaks no agent dialect

The server validates and stores the envelope as defined in `packages/envelope/`. It never references `PreToolUse`, `Stop`, or any other native event name in code. All native names live in `raw_event_type` and are opaque to the server.

**Alternatives considered:** naming the field `hook_event_type` (common in hook-based prior art). Rejected — the name itself encodes "this came from claude-code hooks".

### D2. `event_type` is a free string, not a TypeScript enum

We expose `CANONICAL_EVENT_TYPES` as a `readonly string[]` constant (vocabulary), and `event_type: string` in the envelope. Adapters SHOULD pick from the vocabulary and SHOULD use `"unknown"` when nothing fits. The server logs (does not reject) values outside the vocabulary.

**Why not enum:** every new adapter discovers events the v1 vocabulary missed; an enum forces a coordinated server release for each new mapping. The cost of an enum (dev ergonomics, frontend grouping) does not yet outweigh the cost of premature lock-in.

**Re-evaluation trigger:** once at least three adapters are stable and the vocabulary has not changed for one release cycle, promote it to an enum.

### D3. HITL is an envelope property and is always blocking

`human_in_the_loop` is optional. When present, it MUST include a `callback` of kind `websocket` or `webhook`. We do not support a `none` callback — if an event only needs to notify the user without a response, the adapter emits `event_type: "agent.notification"` without HITL.

**Alternatives considered:** adding `kind: "none"` for fire-and-forget HITL. Rejected — that's just a notification dressed up as HITL and confuses dashboard semantics.

### D4. `EventRepository` and `Broadcaster` are interfaces; v1 ships only the local impls

```
interface EventRepository {
  insert(envelope, receivedAt): StoredEvent
  recent(limit): StoredEvent[]
  filterOptions(): { agent_kinds, source_apps, session_ids, event_types }
  updateHitlResponse(id, response): StoredEvent | null
}

interface Broadcaster {
  subscribe(client): unsubscribe()
  publish(event): void
  snapshot(): StoredEvent[]   // for newly-connected clients
}
```

Implementations: `SqliteEventRepository`, `InMemoryBroadcaster`. The server depends only on the interfaces. A future `PostgresEventRepository` / `RedisBroadcaster` is a swap, not a rewrite.

**Why now and not later:** the abstractions are cheap (≈30 LoC each) and force us to keep the HTTP layer free of `db` calls, which is the actual lock-in we want to avoid.

### D5. Versioned SQL migrations from day one

`db/migrations/0001_init.sql`, `0002_…`, applied by a 30-line `migrate()` function backed by a `schema_version` table. SQL is written ANSI-friendly so the same files port to Postgres with minimal edits.

**Alternatives considered:** rolling `ALTER` heuristics (a common shortcut). Rejected — they become unreadable as columns accumulate, and they don't translate to non-SQLite databases.

### D6. JSON-as-TEXT for variable-shape fields

`payload`, `normalized`, `transcript`, `transcript_ref`, `human_in_the_loop`, `human_in_the_loop_status` are stored as `TEXT` (JSON-encoded). On Postgres these become `JSONB` with no column-shape change. We do NOT add generated columns or JSON1 indexes in v1.

### D7. Hono for HTTP, Bun-native for WebSocket

```
Bun.serve({
  fetch(req, server) {
    if (url.pathname === '/stream') return server.upgrade(req) ? undefined : 400
    return app.fetch(req)            // Hono handles all HTTP routes
  },
  websocket: { open, message, close }
})
```

Hono carries router + CORS only. We will not adopt Hono validators, contexts beyond the basic, or middleware beyond CORS — that keeps it as a "router library" rather than a framework.

**Alternatives considered:** a hand-rolled `if (pathname === ...)` chain. Rejected — even with our small endpoint count, regex-matched dynamic routes (`/events/:id/respond`) read poorly. Hono is ≈14KB, type-safe, swap-out cost is low.

### D8. Validation: hand-written, schema-aware

Server validates incoming envelopes manually (required fields, types, callback shape). No zod / valibot dependency in v1. The published JSON Schema is the canonical contract; we add a unit test that exercises the schema with a JSON Schema validator, but the production code path uses inline checks for speed and zero deps.

**Re-evaluation trigger:** if validation logic exceeds ≈80 LoC, swap to zod.

### D9. Errors are lenient by default

- Invalid envelope → `400`, log the reason, do not crash.
- Unknown `event_type` → accept and store, log a warning.
- Broadcast failure to one client → drop that client, do not affect others.
- HITL callback failure → log and update status to `error`, do not return `5xx` on the human's response endpoint.

The event ingestion path never returns `5xx` for adapter mistakes; only true server faults (DB unavailable) do.

### D10. CORS open by default for local dev, configurable via env

`CORS_ORIGINS` env var, CSV. Default `*`. README will explicitly call this out as a "tighten before exposing to network" item.

## Risks / Trade-offs

- **Risk: vocabulary drift across adapters.** A free-string `event_type` makes it easy for adapters to invent slightly different names (`tool.preuse` vs `tool.pre_use`). → Mitigation: ship a canonical list, lint adapter PRs against it, document the rule in the adapter guide. Future enum promotion (D2) closes the gap permanently.
- **Risk: hand-written validator drifts from the JSON Schema.** → Mitigation: a single test fixture (`fixtures/valid-envelopes.json` + `fixtures/invalid-envelopes.json`) is checked against both the schema and the inline validator.
- **Trade-off: in-memory `Broadcaster` cannot survive process restart.** A reconnecting client only sees events stored in SQLite via `snapshot()`, missing nothing material because all events are persisted before broadcast. Acceptable for v1.
- **Trade-off: no auth.** Anyone reaching the port can post events or read them. Documented; we treat the server as `localhost`-only until auth lands.
- **Risk: payload size unbounded.** A misbehaving adapter could post a 100MB envelope. → Mitigation: README notes a recommended Bun-level body limit and a future `MAX_PAYLOAD_BYTES` env var (TODO marker in code, not implemented in v1).
- **Risk: HITL websocket callback assumes the agent stood up a WS server.** Some agents are short-lived processes (claude-code hooks). The recommended pattern for short-lived hooks is to spawn a temporary WS server inside the hook for the duration of the request; this is documented in the adapter guide. Webhook callbacks are the recommended option for hosted/long-lived agents.

## Migration Plan

This is a fresh repository, no migration from existing data. Deploy: `bun install && bun run apps/server/src/index.ts`. Rollback: stop the process, the database file is harmless to retain.

When the follow-up `claude-code-adapter` change lands, it consumes this server unchanged.

## Open Questions

- **Resolved (deferred): WebSocket reconnect-aware snapshot.** v1 always sends the most recent `WS_SNAPSHOT_LIMIT` events on connect. Reconnect-aware variants (`?since=<id>`, `?limit=<n>`) are deferred until a Dashboard exists and we know the actual reconnect pattern. Re-evaluation trigger: first frontend implementation needs reliable resume semantics.
- **Resolved: add a minimal `GET /health` endpoint in v1.** It returns `200 OK` with `{ "status": "ok" }` whenever the process is serving requests. No DB ping, no broadcaster check — those belong in a future `/ready` endpoint added when the deployment target requires readiness probing.
- **Resolved (deferred): `agent_kind` consistency per `session_id`.** No enforcement in v1. The canonical agent identity is the triple `(agent_kind, source_app, session_id)` — adapter authors and dashboard consumers MUST treat that triple, not `session_id` alone, as the unique key. UUID collision across agents is treated as negligible. Re-evaluation trigger: any query path that uses `session_id` alone as a group key.
