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

| Method | Path                           | Description                          |
|--------|--------------------------------|--------------------------------------|
| GET    | `/health`                      | Liveness probe                       |
| POST   | `/events`                      | Ingest an envelope                   |
| GET    | `/events/recent`               | Most recent events (oldest-first)    |
| GET    | `/events/filter-options`       | Distinct filter values               |
| POST   | `/events/:id/respond`          | Submit a human-in-the-loop response  |
| GET    | `/events/:id/response?wait=30` | Long-poll for a HITL response (polling callback kind) |
| WS     | `/stream`                      | Real-time event push                 |

### Polling callback

Use `callback: { kind: "polling" }` in your `human_in_the_loop` block when the agent cannot expose an inbound URL (e.g. behind NAT, inside CI, on a developer laptop with cloud-hosted echo). The agent polls for the human's answer instead of waiting for a server push.

```bash
# 1. Post an event with a polling callback
curl -s -X POST http://localhost:4000/events \
  -H 'Content-Type: application/json' \
  -d '{"envelope_version":1,"agent_kind":"my-agent","agent_version":"0.1.0",
       "source_app":"my-app","session_id":"s1","event_type":"tool.pre_use",
       "raw_event_type":"PermissionRequest","payload":{},
       "human_in_the_loop":{"question":"Run rm -rf?","type":"permission",
                            "callback":{"kind":"polling"}}}' | jq .id

# 2. Agent long-polls for the response (up to 30s)
curl -m 35 'http://localhost:4000/events/<id>/response?wait=30'

# 3. Human responds via dashboard or API
curl -X POST http://localhost:4000/events/<id>/respond \
  -H 'Content-Type: application/json' \
  -d '{"permission":true,"responded_by":"alice"}'
```

`wait` defaults to `30` seconds, max `60`. Returns `200` with the response body once answered, or `408` on timeout.

## Development

```bash
bun test          # run all tests
bun dev           # start with --watch
```

## Use it with Claude Code

The echo adapter for Claude Code translates all 12 Claude Code hook events into v1 envelopes and ships them to this server. Wire it up once and every session in your project appears in the dashboard automatically.

See [apps/adapter-claude-code/README.md](apps/adapter-claude-code/README.md) for install instructions and copy-pasteable `settings.json` examples.

## Cloud migration

The two interfaces that need swapping for multi-replica cloud deployment:

- [`EventRepository`](apps/server/src/storage/repository.ts) → `PostgresEventRepository`
- [`Broadcaster`](apps/server/src/broadcast/broadcaster.ts) → `RedisPubSubBroadcaster`

See [docs/migration-cloud.md](docs/migration-cloud.md) for the full checklist.

