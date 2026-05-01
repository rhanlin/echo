# API Reference

Base URL (default): `http://localhost:4000`
WebSocket URL: `ws://localhost:4000/stream`

All request and response bodies are JSON. Field names are snake_case.

---

## Health

### `GET /health`

Liveness probe. Does not touch the database or broadcaster.

**Response 200**
```json
{ "status": "ok" }
```

---

## Event ingestion

### `POST /events`

Validate, persist, and broadcast a single envelope.

**Request body**: an `EventEnvelope` (see [adapter-guide.md](./adapter-guide.md)).

**Response 201** — full `StoredEvent` including server-assigned `id` and `timestamp`.

**Response 400** — validation failure.
```json
{ "error": "missing envelope_version" }
```

**Notes**
- If the envelope omits `timestamp`, the server fills it with receive time.
- Non-canonical `event_type` values are accepted; the server logs a warning.

---

### `GET /events/recent`

Most recent events, oldest-first within the window.

**Query parameters**
- `limit` (optional, integer). Default `300`. Clamped to `1000`. Invalid values fall back to default.

**Response 200** — array of `StoredEvent` ordered ascending by `timestamp`.

---

### `GET /events/filter-options`

Distinct values useful for dashboard filter UIs.

**Response 200**
```json
{
  "agent_kinds": ["claude-code", "cursor"],
  "source_apps": ["my-backend", "my-cli"],
  "session_ids": ["sess-1", "sess-2"],
  "event_types": ["session.start", "tool.pre_use"]
}
```

`session_ids` is bounded to the most recent 300 sessions to keep the response small.

---

## Human-in-the-loop

### `POST /events/:id/respond`

Submit a human response for an event whose envelope contained a `human_in_the_loop` block. The server delivers the response via the envelope's declared `callback`, then updates the stored status and broadcasts the change.

**Request body**: `HumanInTheLoopResponse`
```json
{
  "permission": true,
  "responded_by": "alice"
}
```

Other recognized fields: `response` (free text), `choice` (string), `responded_at` (ms epoch — server fills if missing).

**Responses**
- `200` — delivered successfully. Body is the updated `StoredEvent` with `human_in_the_loop_status.status = "responded"`.
- `400` — invalid body, or event has no `human_in_the_loop` block.
- `404` — event not found.
- `409` — already resolved (status was not `pending`).
- `502` — callback delivery failed. Body is the updated `StoredEvent` with status `"error"` and a short `error` string.

---

## WebSocket: `/stream`

Real-time push channel for the dashboard. Server-to-client only in v1; inbound messages are ignored.

### On connect

The server sends a snapshot of the most recent events (oldest-first), bounded by `WS_SNAPSHOT_LIMIT` (default 300).

```json
{ "type": "snapshot", "data": [ /* StoredEvent[] */ ] }
```

### On every new event

```json
{ "type": "event", "data": { /* StoredEvent */ } }
```

This includes both fresh ingests AND HITL status updates (the latter republish the same event id with an updated `human_in_the_loop_status`).

### Disconnects

The server cleans up subscribers automatically on `close`. Reconnect freely; you'll receive a fresh snapshot.

---

## Error responses

All errors share this shape:

```json
{ "error": "human-readable reason" }
```

The server does **not** include stack traces or internal identifiers in error bodies.
