## Why

Echo's HITL contract today supports two callback kinds — `websocket` and `webhook` — both of which require the **server to initiate a connection back to the agent**. That breaks the moment echo is hosted in the cloud while the agent runs on a developer's laptop, inside CI, or anywhere behind NAT/firewalls without a public URL. Cloud-hosted echo is the natural next deployment target (and a prerequisite for sharing observability across a team), so we need a callback transport that works when the agent has no inbound connectivity.

## What Changes

- Add a third HITL callback variant: `{ kind: "polling" }`. The agent provides no URL — it polls the server for the response when it's ready.
- Add `GET /events/:id/response?wait=<seconds>` — a long-poll endpoint that returns the recorded HITL response, or holds the connection up to `wait` seconds (default 30, max 60) waiting for one, or returns 408 if no response arrives in time.
- Server-side waiter map: when a `POST /events/:id/respond` arrives, any in-flight long-pollers for that event are woken immediately.
- `polling` callback is a no-op for `deliver.ts` — the response is already in storage; agents pull instead of being pushed.
- Update envelope schema (`packages/envelope/schema.json`) and TypeScript types (`packages/envelope/types.ts`) to accept the new variant.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `human-in-the-loop`: add `polling` as a third valid `callback.kind`, plus the long-poll response endpoint and waiter-wakeup semantics.
- `event-envelope`: extend `human_in_the_loop.callback` discriminated union to accept the polling variant.

## Impact

- **Envelope contract** (additive, backwards-compatible): `packages/envelope/schema.json`, `packages/envelope/types.ts`. Existing `websocket` / `webhook` variants unchanged.
- **Server**:
  - `apps/server/src/envelope/validate.ts` — accept `kind: "polling"`.
  - `apps/server/src/hitl/deliver.ts` — short-circuit success for polling.
  - `apps/server/src/http/routes/hitl.ts` — register `GET /events/:id/response`, wake waiters on `POST .../respond`.
  - New `apps/server/src/hitl/waiters.ts` — in-process `Map<event_id, Set<resolver>>`.
- **Tests**: TS suite gains long-poll happy-path, timeout, and idempotent-double-poll cases.
- **Adapters**: no change required (claude-code adapter doesn't yet emit HITL blocks). Future Python `hitl-helper-python` library will be the first consumer.
- **Out of scope**: auth (separate `echo-cloud-auth` change), server-driven HITL timeouts, persistent waiter queues / multi-replica fanout (in-process only for v1).
