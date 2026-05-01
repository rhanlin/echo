# echo

Agent-agnostic observability backend. Intercepts lifecycle events from AI coding agents (Claude Code), persists them to SQLite, and streams them to any subscriber over WebSocket.

- **No agent-specific code** — wire format is a versioned envelope contract (`packages/envelope/`)
- **Single Bun process**, zero external deps (no Redis, no Postgres, no Docker)
- **Clean swap boundaries** — `EventRepository` and `Broadcaster` are interfaces; swap to Postgres + Redis without touching routes

## Requirements

- [Bun](https://bun.sh) ≥ 1.0

## Quick start

```bash
git clone <repo> && cd echo
bun install
bun start          # http://localhost:4000  ws://localhost:4000/stream
```

Send an event:

```bash
curl -s -X POST http://localhost:4000/events \
  -H 'Content-Type: application/json' \
  -d '{
    "envelope_version": 1,
    "agent_kind": "claude-code",
    "agent_version": "1.0.0",
    "source_app": "my-app",
    "session_id": "sess-001",
    "event_type": "session.start",
    "raw_event_type": "SessionStart",
    "payload": {}
  }'
```

Check health:

```bash
curl http://localhost:4000/health
# {"status":"ok"}
```

Stream events (requires [`wscat`](https://github.com/websockets/wscat)):

```bash
wscat -c ws://localhost:4000/stream
```

## Environment variables

| Variable           | Default      | Description                                              |
|--------------------|--------------|----------------------------------------------------------|
| `SERVER_PORT`      | `4000`       | HTTP + WebSocket listen port                             |
| `DB_PATH`          | `events.db`  | SQLite file path. Use `:memory:` for ephemeral runs.     |
| `CORS_ORIGINS`     | `*`          | Comma-separated allowed origins, or `*` for open.        |
| `WS_SNAPSHOT_LIMIT`| `300`        | Max events in the initial `/stream` snapshot.            |

Copy `.env.example` → `.env` to override defaults.

## Envelope contract

Every adapter must POST a JSON object matching the `EventEnvelope` v1 shape:

- TypeScript types: [`packages/envelope/types.ts`](packages/envelope/types.ts)
- JSON Schema (cross-language): [`packages/envelope/envelope.schema.json`](packages/envelope/envelope.schema.json)
- Canonical event-type vocabulary: [`packages/envelope/event-types.ts`](packages/envelope/event-types.ts)

See [docs/adapter-guide.md](docs/adapter-guide.md) for the full authoring guide with Python + TypeScript snippets.

## API

See [docs/api.md](docs/api.md) for the full endpoint reference.

| Method | Path                      | Description                          |
|--------|---------------------------|--------------------------------------|
| GET    | `/health`                 | Liveness probe                       |
| POST   | `/events`                 | Ingest an envelope                   |
| GET    | `/events/recent`          | Most recent events (oldest-first)    |
| GET    | `/events/filter-options`  | Distinct filter values               |
| POST   | `/events/:id/respond`     | Submit a human-in-the-loop response  |
| WS     | `/stream`                 | Real-time event push                 |

## Development

```bash
bun test          # run all tests
bun dev           # start with --watch
```

## Cloud migration

The two interfaces that need swapping for multi-replica cloud deployment:

- [`EventRepository`](apps/server/src/storage/repository.ts) → `PostgresEventRepository`
- [`Broadcaster`](apps/server/src/broadcast/broadcaster.ts) → `RedisPubSubBroadcaster`

See [docs/migration-cloud.md](docs/migration-cloud.md) for the full checklist.

