## Context

Echo's HITL response delivery currently has two callback kinds: `websocket` (server opens a WS to the agent) and `webhook` (server POSTs HTTP to the agent). Both assume **server → agent** reachability. That assumption breaks for the most natural cloud deployment: echo running on a hosted box, agents running on developers' laptops behind NAT.

Two options exist:

1. Make agents expose ngrok-style tunnels — a per-developer setup tax that defeats "drop the adapter into your repo and go".
2. Invert the direction: agent calls server, server holds the response until a human picks it. This is the standard pattern for any client-only environment (mobile push fallback, CI runners, browser extensions).

This change picks option 2 by adding a `polling` callback kind backed by a long-poll endpoint. It's intentionally minimal — a single new endpoint, no auth, no persistent queue. The next change in the chain (`echo-cloud-auth` and eventually `hitl-helper-python`) will build on this.

## Goals / Non-Goals

**Goals**

- Agents in any network environment (laptop, CI, devcontainer, behind corporate proxy) can receive HITL responses **without exposing any inbound port**.
- Backwards-compatible — existing `websocket` and `webhook` callbacks keep working unchanged.
- Server response time bounded: long-poll completes in ≤ `wait` seconds (default 30, max 60) regardless of human latency.
- Wake-up latency from human response → polling agent: < 50ms in-process (no DB poll loop).

**Non-Goals**

- **Auth.** Polling makes the gap obvious because cloud-hosted = "anyone on the internet can read my HITL responses if they know an event id". Authentication is its own change (`echo-cloud-auth`); this change explicitly leaves the endpoint open like the rest of the API.
- **Multi-replica fanout.** Waiter map is in-process. If two echo replicas behind a load balancer each hold polling agents, only the replica that processes the human's `POST /respond` wakes its own waiters. Multi-replica HITL is out of scope until echo actually deploys multi-replica (currently single-process by design — see the bootstrap-server change).
- **Server-driven timeouts.** Server doesn't auto-cancel pending HITL requests. Agent decides when to give up by stopping its poll loop. Reasonable for v1; revisit if dashboards accumulate visibly stuck `pending` rows.
- **Push notifications / webhooks-on-respond.** This change adds *one* new transport, not a richer event bus.
- **Persistence of in-flight polls across restart.** If echo restarts, all open long-polls return 408 (or get TCP-reset); agents reconnect on next iteration. Acceptable since polls are short-lived (≤60s).

## Decisions

### Decision 1: Long-poll, not SSE or short-poll

The agent calls `GET /events/:id/response?wait=<sec>` and the server holds the connection until either (a) a response is recorded, or (b) `wait` seconds elapse. Returns 200 with the response body, or 408 on timeout.

**Why:** matches the agent's actual lifecycle. A claude-code hook process that called `ask_permission()` is a short-lived process that wants ONE answer. Long-poll fits that perfectly: one open connection, one response, done. SSE would need event-id replay, reconnect logic, and a second decision about when to close; short-poll wastes bandwidth and adds delay equal to the poll interval.

**Alternatives considered:**

- **SSE** (`GET /events/:id/response/stream`): rejected — extra complexity (`Last-Event-ID`, retry semantics) for a use case that always wants exactly one message.
- **Short-poll loop** (e.g., agent calls every 2s): rejected — wastes server resources and adds a worst-case 2s of delay even when the human answers instantly. Long-poll is strictly better.
- **WebSocket from agent → server**: rejected — adds a second WS protocol on the server, when long-poll over HTTP works on every existing HTTP-aware deployment without changes.

### Decision 2: Polling callback has zero fields besides `kind`

```jsonc
{ "kind": "polling" }
```

No `url` (response lives in storage), no `timeout_ms` (the agent supplies it via `?wait=`), no `token` (auth is its own change).

**Why:** keep the envelope contract additive and minimal. The request-response coupling is "agent already knows the event id from the `POST /events` response, so it knows what to GET." Bloating the callback shape now would commit us to fields we'd regret in v2.

**Alternatives considered:**

- `{ kind: "polling", timeout_ms: 30000 }` — rejected. Timeout is a transport detail of the GET, not a property of the envelope; baking it into the persisted record is misplaced.
- `{ kind: "polling", token: "..." }` — rejected for now. When auth lands as `echo-cloud-auth`, it'll likely apply to all endpoints uniformly, not be HITL-specific.

### Decision 3: Wake-up via in-process `Map<event_id, Set<resolver>>`

When `POST /events/:id/respond` succeeds, the server iterates the waiter set for that id and resolves each pending promise. New file: `apps/server/src/hitl/waiters.ts`. Pattern mirrors `apps/server/src/broadcast/inMemoryBroadcaster.ts`.

```
   ┌─────────────────────────────────────────────┐
   │ apps/server/src/hitl/waiters.ts             │
   │                                             │
   │   waiters: Map<eventId, Set<{ resolve }>>   │
   │                                             │
   │   register(id, resolver, abortSignal)       │
   │   wake(id, response)                        │
   │   cancel(id, resolver) // on abort/timeout  │
   └─────────────────────────────────────────────┘
            ▲                          │
            │ register from GET        │ wake from POST .../respond
            │                          ▼
   ┌────────┴──────────┐    ┌─────────────────────┐
   │ /events/:id/      │    │ /events/:id/respond │
   │     response      │    │                     │
   │ (long-poller)     │    │ (human's answer)    │
   └───────────────────┘    └─────────────────────┘
```

**Why:** in-process works for the single-replica deployment (current design). Latency ~submillisecond. No DB polling. When/if echo goes multi-replica, swap the implementation behind a `Waiters` interface for Redis pub/sub — the route handlers don't change. Same migration story as the broadcaster.

**Alternatives considered:**

- DB polling loop: rejected — adds load proportional to open polls × poll interval, when the wake event is naturally "right now".
- Per-event Bun `EventEmitter`: rejected — easy to leak listeners; explicit Map+Set with `cancel()` makes cleanup auditable.

### Decision 4: Response is idempotent — re-polling after answer is fine

If a polling client misses the response (network drop) and re-polls, server immediately returns 200 with the same body. Stored once in `human_in_the_loop_status.response`, served as many times as asked.

**Why:** GET should be idempotent (HTTP basic). Also defends against the common "agent retries on transient error" pattern without server-side dedupe state.

**Alternatives considered:**

- One-shot delivery (next poll → 410 Gone): rejected — punishes agents for normal network flakiness. The dashboard already broadcasts the response; one extra HTTP serve is free.

### Decision 5: Cap `wait` at 60s; default to 30s

If `wait` is missing, default to 30. If supplied and > 60, clamp to 60. If ≤ 0, return immediately (degrades to short-poll).

**Why:** balances two pressures. Too long → idle connections eating server file descriptors, possible reverse-proxy timeouts (most defaults 60–120s). Too short → agents reconnect frequently, adding traffic. 30s default is what GitHub's API and most long-poll-style endpoints settle on.

**Alternatives considered:**

- No cap, trust the client: rejected — easy DoS, also breaks behind common reverse proxies.
- Configurable max: rejected for v1 — one knob, one default. Future change can env-var it.

### Decision 6: New endpoint, not overloading `GET /events/:id`

`GET /events/:id/response` is its own route, distinct from `GET /events/:id` (which already exists or will exist for fetching an event). Returns ONLY the HITL response body, not the full envelope.

**Why:** semantic clarity (the *response* sub-resource), avoids long-poll behavior surprising consumers of the regular event-fetch endpoint, and lets us add response-specific querystring params (`wait`) without polluting the event endpoint.

## Risks / Trade-offs

**Risk 1: Open file descriptors / connection limits under load.**
→ Each long-poll holds a TCP socket for up to 60s. At Bun's default limits, hundreds of simultaneous polls are fine; thousands could hit `ulimit -n`. Mitigation: log waiter count alongside event count in `/health`. Revisit if production deployments report saturation. Capping `wait` at 60s bounds the worst case anyway.

**Risk 2: Reverse proxy / CDN buffers may swallow long-poll.**
→ Standard reverse-proxy footgun. Mitigation: document in adapter README that for cloud-hosted echo, the proxy must allow ≥60s idle (most do by default). Set `Cache-Control: no-store` on the response so CDNs don't cache the empty hold.

**Risk 3: Memory leak if waiters aren't cleaned up.**
→ Every register MUST be paired with a cancel (on abort, timeout, or wake). Mitigation: `register()` returns a cleanup function; the route handler always calls it in a `finally`. Add a test that simulates 10k abandoned polls and asserts the map shrinks back to size 0.

**Risk 4: Restart drops in-flight polls.**
→ Acceptable. Agent's poll fails, agent retries with same event id, server's now-restarted process serves the response from storage immediately (response was persisted before restart). Worst-case latency: one round-trip extra.

**Trade-off: No auth means cloud deployment is risky out-of-the-box.**
→ Accepted explicitly. README will warn. Not blocking this change because: (a) auth applies uniformly to all endpoints, not just polling; (b) hosting echo without auth on the public internet is already unsafe (anyone can POST events); (c) most users will start with localhost or VPN-internal, where this is fine.

## Migration Plan

Pure additive — no migration. Steps:

1. Land schema + validator changes — existing envelopes unaffected.
2. Land server route + waiter module — endpoint becomes available.
3. Update `human-in-the-loop` spec.
4. Future change `hitl-helper-python` provides the agent-side library that uses this transport.

Rollback: revert the commits. No data shape changes, no migrations, no rollback hazards.

## Open Questions

- **Q1**: Should `GET /events/:id/response` 404 vs 400 vs 200-with-empty for "event exists but has no `human_in_the_loop` block"? Lean **400** (matches `POST .../respond` for the same condition).
- **Q2**: What does `responded_by` look like when nobody is logged in (no auth yet)? Lean **server defaults to `"anonymous"`** if absent, future auth change will populate it.
- **Q3**: Do we need a separate test mode where `wait` allows shorter than the 1s minimum, for fast tests? Lean **no clamp on the floor** — `wait=0` returns immediately.
