# Event Ingestion Specification

## Purpose
TBD


## Requirements

### Requirement: Event ingestion endpoint

The server SHALL expose `POST /events` accepting a JSON `EventEnvelope`. On a structurally valid envelope it SHALL persist the event via `EventRepository.insert` and broadcast it via `Broadcaster.publish`. The response SHALL be the stored event including server-assigned `id` and `timestamp`.

#### Scenario: Successful ingestion

- **WHEN** a valid envelope is posted to `POST /events`
- **THEN** the response is HTTP 201 with the stored event JSON, the event is persisted, and all current WebSocket subscribers receive a `{ type: "event", data: <stored event> }` message

#### Scenario: Invalid envelope

- **WHEN** an envelope fails validation (missing field, wrong type, unsupported version, invalid HITL callback)
- **THEN** the response is HTTP 400 with `{ error: <reason> }` and no event is persisted or broadcast

#### Scenario: Repository failure does not crash the server

- **WHEN** `EventRepository.insert` throws an unexpected error
- **THEN** the server responds HTTP 500, logs the error with the offending envelope's identifying fields (agent_kind, source_app, session_id, raw_event_type), and continues serving subsequent requests

### Requirement: Server-assigned timestamp fallback

When an envelope omits `timestamp`, the server SHALL fill in the receive time (milliseconds since epoch) before persistence. When `timestamp` is provided, the server SHALL trust it and persist as-is.

#### Scenario: Adapter omits timestamp

- **WHEN** an envelope without `timestamp` arrives
- **THEN** the persisted record's `timestamp` equals the server's receive time within ±100ms

#### Scenario: Adapter supplies timestamp

- **WHEN** an envelope with `timestamp: 1730000000000` arrives
- **THEN** the persisted record retains exactly `1730000000000`

### Requirement: Recent events query

The server SHALL expose `GET /events/recent?limit=<n>` returning the most recent events ordered by `timestamp` ascending (so the newest is last in the array). The default `limit` SHALL be 300; the maximum allowed `limit` SHALL be 1000.

#### Scenario: Default limit

- **WHEN** a client calls `GET /events/recent` with no parameters
- **THEN** the server returns up to 300 events ordered oldest-to-newest

#### Scenario: Custom limit within bounds

- **WHEN** a client calls `GET /events/recent?limit=50`
- **THEN** the server returns up to 50 events

#### Scenario: Limit exceeds maximum

- **WHEN** a client calls `GET /events/recent?limit=5000`
- **THEN** the server clamps the response to 1000 events

### Requirement: Filter options query

The server SHALL expose `GET /events/filter-options` returning distinct values for client-side filtering: `agent_kinds`, `source_apps`, `session_ids` (limited to most recent 300), and `event_types`.

#### Scenario: Filter options shape

- **WHEN** a client calls `GET /events/filter-options`
- **THEN** the response is `{ agent_kinds: string[], source_apps: string[], session_ids: string[], event_types: string[] }` with each array containing distinct values from the events table

### Requirement: CORS configuration

The server SHALL allow cross-origin requests according to the `CORS_ORIGINS` environment variable, a comma-separated list of allowed origins. The default value SHALL be `*` (open). The server SHALL respond to `OPTIONS` preflight requests with the appropriate `Access-Control-Allow-*` headers.

#### Scenario: Default permissive CORS

- **WHEN** `CORS_ORIGINS` is unset and any origin sends a preflight `OPTIONS /events`
- **THEN** the server responds with `Access-Control-Allow-Origin: *`

#### Scenario: Restricted CORS

- **WHEN** `CORS_ORIGINS` is set to `https://dash.example.com,http://localhost:5173` and a request arrives from `https://dash.example.com`
- **THEN** the server echoes that origin in `Access-Control-Allow-Origin`

#### Scenario: Disallowed origin

- **WHEN** `CORS_ORIGINS` is set and a request arrives from an origin not in the list
- **THEN** the server omits `Access-Control-Allow-Origin` from the response

### Requirement: Health endpoint

The server SHALL expose `GET /health` returning HTTP 200 with JSON body `{ "status": "ok" }` whenever the process is serving requests. The endpoint SHALL NOT depend on the database, broadcaster, or any other subsystem; it is a process-liveness signal only. The endpoint SHALL NOT require CORS preflight handling beyond the default rules.

#### Scenario: Server is running

- **WHEN** a client calls `GET /health` while the server is running
- **THEN** the response is HTTP 200 with body `{ "status": "ok" }` and `Content-Type: application/json`

#### Scenario: Health endpoint is independent of storage

- **WHEN** the database is intentionally made unavailable (e.g. file removed) but the process is still running
- **THEN** `GET /health` still returns HTTP 200 (this endpoint reports liveness, not readiness)

### Requirement: Lenient unknown-event-type handling

The server SHALL accept envelopes whose `event_type` is not in `CANONICAL_EVENT_TYPES`. It SHALL log a warning identifying the unknown value, but it SHALL NOT reject the request.

#### Scenario: Unknown event type stored

- **WHEN** an envelope with `event_type: "tool.something_new"` is posted
- **THEN** the server accepts it, stores it, broadcasts it, and emits a single warning log line containing the unknown value
