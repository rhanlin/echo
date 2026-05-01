# Cloud Migration Notes

Localhost-first defaults make v1 simple, but the codebase is structured so the move to a multi-tenant cloud deployment is mostly **swapping implementations behind two interfaces** plus adding the cross-cutting concerns localhost doesn't need.

## Boundaries to swap

| Boundary                                                               | v1 implementation                              | Cloud target                                  |
| ---------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------- |
| [`EventRepository`](../apps/server/src/storage/repository.ts)          | `SqliteEventRepository` (bun:sqlite, WAL)      | `PostgresEventRepository` (managed Postgres)  |
| [`Broadcaster`](../apps/server/src/broadcast/broadcaster.ts)           | `InMemoryBroadcaster` (single-process Set)     | `RedisPubSubBroadcaster` (cross-replica)      |

Files marked with `CLOUD MIGRATION BOUNDARY` headers must remain pure interfaces.

## Schema portability

`migrations/0001_init.sql` was written ANSI-friendly:

- `INTEGER PRIMARY KEY AUTOINCREMENT` → `BIGSERIAL PRIMARY KEY`
- Variable-shape JSON columns are `TEXT` in SQLite, plan to use `JSONB` in Postgres
- No SQLite-only functions are used in queries

Future migration files (`0002_*.sql` …) should preserve this discipline.

## Cross-cutting concerns to add

These were intentionally deferred in v1:

1. **Authentication** — add an HTTP middleware ahead of all routes (JWT / API token). The HTTP layer never bypasses middleware, so this is a single insertion point in the composition root.
2. **Tighten CORS** — replace `CORS_ORIGINS=*` with an explicit allow-list per tenant.
3. **Payload size cap** — introduce `MAX_PAYLOAD_BYTES` (suggest 1 MiB) before `c.req.json()`.
4. **Rate limiting** — wrap `POST /events` with a per-token bucket.
5. **Multi-tenant isolation** — extend `agent_kind` / `source_app` indexing with a `tenant_id` column, indexed.
6. **Observability** — structured logs (JSON), request tracing IDs, `/metrics` endpoint.
7. **HITL callbacks at scale** — webhooks/websockets that originate from a server cluster need shared state for delivery retries; consider moving callback delivery to a queued worker.

## Things that DO NOT need to change

- The envelope contract (`packages/envelope/`) is wire-stable across deployments.
- Adapter code does not change between localhost and cloud — only the base URL and (eventually) auth header.
- The HTTP route handlers (`apps/server/src/http/routes/*.ts`) depend only on the interfaces; no rewrite needed.
