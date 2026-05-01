## 1. Workspace bootstrap

- [x] 1.1 Initialize root `package.json` with workspaces (`apps/*`, `packages/*`)
- [x] 1.2 Initialize `apps/server/` with `package.json`, `tsconfig.json`, `bun-types`
- [x] 1.3 Initialize `packages/envelope/` with `package.json`, `tsconfig.json`
- [x] 1.4 Add `hono` dependency to `apps/server/`
- [x] 1.5 Add a root `.gitignore` (node_modules, *.db, *.db-wal, *.db-shm)
- [x] 1.6 Add a root `README.md` placeholder section structure (filled in §9)

## 2. Envelope contract package

- [x] 2.1 Implement `packages/envelope/types.ts` with `EventEnvelope`, `NormalizedFields`, `TranscriptMessage`, `TranscriptRef`, `HumanInTheLoop`, `HitlCallback`, `HumanInTheLoopResponse`, `HumanInTheLoopStatus`, `StoredEvent`
- [x] 2.2 Implement `packages/envelope/event-types.ts` exporting `CANONICAL_EVENT_TYPES` and `CanonicalEventType`
- [x] 2.3 Author `packages/envelope/envelope.schema.json` (JSON Schema draft 2020-12) mirroring the TS types
- [x] 2.4 Add `packages/envelope/fixtures/valid-envelopes.json` and `invalid-envelopes.json` covering: missing required fields, wrong version, invalid HITL callback kind, choice without choices, valid minimal, valid with HITL, valid with transcript
- [x] 2.5 Re-export the public surface from `packages/envelope/index.ts`

## 3. Server: configuration & composition root

- [x] 3.1 Implement `apps/server/src/config.ts` reading `SERVER_PORT`, `DB_PATH`, `CORS_ORIGINS`, `WS_SNAPSHOT_LIMIT` from env with documented defaults
- [x] 3.2 Implement `apps/server/src/index.ts` as composition root: load config → run migrations → instantiate `SqliteEventRepository` and `InMemoryBroadcaster` → register HTTP routes → start `Bun.serve`

## 4. Server: storage layer

- [x] 4.1 Define `apps/server/src/storage/repository.ts` exporting `EventRepository` interface and `FilterOptions` type
- [x] 4.2 Author `apps/server/src/storage/migrations/0001_init.sql` creating `events` and `schema_version` tables plus all indexes per spec; include comments for Postgres-equivalent syntax
- [x] 4.3 Implement `apps/server/src/storage/migrate.ts`: discover migration files, read `schema_version`, apply pending in numeric order each in its own transaction, log applied versions, exit on failure
- [x] 4.4 Implement `apps/server/src/storage/sqlite-repository.ts`: WAL pragmas, prepared statements for `insert`, `recent`, `filterOptions`, `updateHitlResponse`, JSON encode/decode of variable-shape fields
- [x] 4.5 Add `apps/server/test/storage.test.ts` covering insert→read round-trip, filter options distinctness, HITL update, query plan check that recent uses `idx_timestamp`

## 5. Server: validation & broadcast

- [x] 5.1 Implement `apps/server/src/envelope/validate.ts`: hand-written validator returning `{ ok: true, envelope } | { ok: false, error }`. Cover all spec scenarios (missing fields, wrong version, invalid HITL callback, choice without choices, empty identity strings, camelCase rejection)
- [x] 5.2 Implement `apps/server/src/broadcast/broadcaster.ts` exporting the `Broadcaster` interface
- [x] 5.3 Implement `apps/server/src/broadcast/in-memory.ts` (`InMemoryBroadcaster`): subscribe/unsubscribe set, publish with try/catch + auto-removal on send failure, snapshot delegation to repository
- [x] 5.4 Add `apps/server/test/validate.test.ts` exercising the fixtures from §2.4 against the validator AND against the JSON Schema (using a lightweight validator like `@cfworker/json-schema` or hand-pull `ajv` in dev deps), asserting both agree

## 6. Server: HTTP & WebSocket layer

- [x] 6.1 Implement `apps/server/src/http/cors.ts`: middleware reading `CORS_ORIGINS`, supporting `*` and CSV origin lists, handling preflight
- [x] 6.2 Implement `apps/server/src/http/routes/events.ts`: `POST /events` (validate → insert → broadcast → 201), `GET /events/recent` (clamp limit ≤1000, default 300), `GET /events/filter-options`
- [x] 6.3 Implement `apps/server/src/http/routes/health.ts`: `GET /health` returning `{ status: "ok" }` (no DB / broadcaster dependency)
- [x] 6.4 Implement `apps/server/src/http/routes/hitl.ts`: `POST /events/:id/respond` (404 if missing, 400 if no HITL, update status, deliver callback, broadcast)
- [x] 6.5 Implement `apps/server/src/hitl/deliver.ts`: `deliverWebsocket` (5s timeout, single frame, close after) and `deliverWebhook` (5s timeout, default POST, treat non-2xx as failure)
- [x] 6.6 Implement `apps/server/src/ws/stream.ts`: Bun WebSocket handlers (`open` sends `{ type: "snapshot", data }` of recent N, `message` ignored, `close` removes from broadcaster)
- [x] 6.7 Wire `apps/server/src/index.ts`: `Bun.serve({ fetch, websocket })` where `fetch` upgrades `/stream` and otherwise delegates to Hono `app.fetch`

## 7. Server: integration tests

- [x] 7.1 Add `apps/server/test/integration/ingest.test.ts`: post valid + invalid envelopes, assert persistence, assert subscriber receives broadcast
- [x] 7.2 Add `apps/server/test/integration/recent.test.ts`: seed N events, query with default and custom limits, assert ordering and clamp behavior
- [x] 7.3 Add `apps/server/test/integration/filter-options.test.ts`: seed events across multiple agent_kinds/source_apps, assert distinctness
- [x] 7.4 Add `apps/server/test/integration/hitl.test.ts`: post HITL envelope → status pending → respond → status responded; failing webhook → status error; broadcast is observed in both transitions
- [x] 7.5 Add `apps/server/test/integration/ws-snapshot.test.ts`: connect, assert snapshot ordering and `WS_SNAPSHOT_LIMIT` honored

## 8. Operations & DX

- [x] 8.1 Add `apps/server/scripts/run.sh` (or root `justfile` recipe) for `bun run apps/server/src/index.ts` with sample env
- [x] 8.2 Add a `bun test` root script that runs both package and app tests
- [x] 8.3 Add `.env.example` documenting `SERVER_PORT`, `DB_PATH`, `CORS_ORIGINS`, `WS_SNAPSHOT_LIMIT`

## 9. Documentation

- [x] 9.1 Write `README.md` (root): what it is, how to run locally, env vars, where the envelope contract lives, future cloud markers (interfaces to swap)
- [x] 9.2 Write `docs/adapter-guide.md`: envelope contract overview, canonical event types table, how to map a native event, HITL callback options, link to JSON Schema, minimal Python and TypeScript reference snippets for `POST /events`
- [x] 9.3 Write `docs/api.md`: endpoint reference for `POST /events`, `GET /events/recent`, `GET /events/filter-options`, `POST /events/:id/respond`, `WS /stream`
- [x] 9.4 Add `docs/migration-cloud.md` (short): bullet list of "what to swap when moving to cloud" — `EventRepository` to Postgres, `Broadcaster` to Redis, add auth middleware, tighten CORS, set `MAX_PAYLOAD_BYTES`
- [x] 9.5 In each interface file (`repository.ts`, `broadcaster.ts`) add a top-of-file comment marking it as the cloud-migration boundary

## 10. Verification

- [x] 10.1 Run `bun test` — all suites green
- [x] 10.2 Run `bun run apps/server/src/index.ts`, hit `POST /events` with curl using a valid example, observe persistence and broadcast via `wscat` against `/stream`
- [x] 10.3 Run `openspec validate bootstrap-server` and confirm clean
- [x] 10.4 Update root README quickstart from real, working commands
