# Human In The Loop Specification

## Purpose
TBD
## Requirements
### Requirement: HITL request persistence

When an envelope arrives with a `human_in_the_loop` block, the server SHALL persist it alongside the event and SHALL initialize a `human_in_the_loop_status` of `{ status: "pending" }`. The HITL block SHALL be visible to all WebSocket subscribers in the broadcast event.

#### Scenario: HITL initialization

- **WHEN** an envelope with `human_in_the_loop` is ingested
- **THEN** the persisted event has `human_in_the_loop` set verbatim and `human_in_the_loop_status` set to `{ "status": "pending" }`

### Requirement: HITL response endpoint

The server SHALL expose `POST /events/:id/respond` accepting a JSON `HumanInTheLoopResponse` (`{ response?, permission?, choice?, responded_by? }`). On receipt the server SHALL: (1) update the event's `human_in_the_loop_status` to `{ status: "responded", responded_at: <ms>, response: <body> }`, (2) deliver the response to the requesting agent via the envelope's `callback`, and (3) broadcast the updated event to all WebSocket subscribers.

#### Scenario: Successful response

- **WHEN** a human posts `{ permission: true }` to `POST /events/42/respond` for a pending HITL event with a websocket callback
- **THEN** the server updates `human_in_the_loop_status` to `{ status: "responded", responded_at, response }`, sends the response payload to the callback URL, and broadcasts the updated event to subscribers

#### Scenario: Event not found

- **WHEN** the request targets an event id that does not exist
- **THEN** the server responds HTTP 404 with `{ error: "Event not found" }`

#### Scenario: Event has no HITL block

- **WHEN** the request targets an event whose `human_in_the_loop` is null
- **THEN** the server responds HTTP 400 with `{ error: "Event does not have a HITL request" }`

### Requirement: Callback delivery — websocket

When the envelope's `callback.kind` is `websocket`, the server SHALL open a client WebSocket connection to `callback.url`, send the response as a single JSON text frame, and close the connection. The send SHALL time out after 5 seconds.

#### Scenario: WebSocket delivery succeeds

- **WHEN** the agent's WebSocket server is reachable at the callback URL
- **THEN** the server connects, sends `{ response | permission | choice, responded_at, responded_by? }` as JSON, closes within ~500ms after send, and the human's response endpoint returns HTTP 200

#### Scenario: WebSocket delivery fails

- **WHEN** the callback URL is unreachable or the connection times out
- **THEN** the server logs the failure, sets `human_in_the_loop_status` to `{ status: "error", … }`, broadcasts the updated status, and the human's response endpoint still returns HTTP 200 (the human's decision is recorded even if the agent can no longer be reached)

### Requirement: Callback delivery — webhook

When the envelope's `callback.kind` is `webhook`, the server SHALL send the response as the JSON body of a single HTTP request using `callback.method` (default `POST`) to `callback.url`. The request SHALL time out after 5 seconds. Non-2xx responses SHALL be treated as delivery failure.

#### Scenario: Webhook delivery succeeds

- **WHEN** the callback URL responds 2xx within 5s
- **THEN** the server records `human_in_the_loop_status` as `responded` and the human's response endpoint returns HTTP 200

#### Scenario: Webhook delivery fails

- **WHEN** the callback URL responds 5xx or times out
- **THEN** the server records `human_in_the_loop_status` as `{ status: "error", … }` and the human's response endpoint returns HTTP 200

### Requirement: Status broadcast

After any HITL status transition (`pending → responded`, `pending → error`, `pending → timeout`), the server SHALL publish the updated stored event so all WebSocket subscribers can re-render the row.

#### Scenario: Subscriber sees status update

- **WHEN** a subscriber is connected and a HITL response is recorded for event 42
- **THEN** the subscriber receives a `{ type: "event", data: <event 42 with updated status> }` message

### Requirement: Polling callback kind

The envelope SHALL accept `human_in_the_loop.callback.kind` value `"polling"` in addition to the existing `"websocket"` and `"webhook"` values. When `kind` is `"polling"`, no other callback fields SHALL be required or used; the agent retrieves the response via the polling endpoint instead of receiving a server-initiated push.

#### Scenario: Polling callback validation

- **WHEN** an envelope with `human_in_the_loop.callback: { "kind": "polling" }` is POSTed to `/events`
- **THEN** the server accepts the envelope, persists it, and treats the HITL block as valid

#### Scenario: Polling callback delivery is a no-op

- **WHEN** a `POST /events/:id/respond` succeeds for an event whose callback is `{ "kind": "polling" }`
- **THEN** the server SHALL NOT initiate any outbound connection; the response is served only via the polling endpoint and the persisted `human_in_the_loop_status`

### Requirement: Long-poll response endpoint

The server SHALL expose `GET /events/:id/response` returning the recorded HITL response. The endpoint SHALL accept an optional `wait` query parameter (integer seconds, default 30). The server SHALL clamp `wait` to a maximum of 60 and treat any value ≤ 0 as "return immediately". If a response is already recorded for the event, the server SHALL return HTTP 200 with the response body immediately. Otherwise, the server SHALL hold the connection until either (a) a response is recorded for the event, returning HTTP 200, or (b) `wait` seconds elapse without a response, returning HTTP 408. The endpoint SHALL be idempotent — repeated requests for the same answered event return the same response.

#### Scenario: Response already recorded

- **WHEN** the agent calls `GET /events/42/response?wait=30` for an event whose `human_in_the_loop_status` is `{ status: "responded", response: <body> }`
- **THEN** the server immediately returns HTTP 200 with the recorded response body

#### Scenario: Response arrives during long-poll

- **WHEN** the agent calls `GET /events/42/response?wait=30` while the event is still pending, and a human posts a response 5 seconds later
- **THEN** the long-poll connection wakes within 50ms of the response being recorded and returns HTTP 200 with the response body

#### Scenario: Long-poll times out

- **WHEN** the agent calls `GET /events/42/response?wait=5` and no response is recorded within 5 seconds
- **THEN** the server returns HTTP 408 with a body indicating timeout, and the event remains in `pending` status

#### Scenario: Wait clamped to maximum

- **WHEN** the agent calls `GET /events/42/response?wait=600`
- **THEN** the server treats `wait` as 60 seconds and returns 408 after at most 60 seconds if no response arrives

#### Scenario: Wait of zero returns immediately

- **WHEN** the agent calls `GET /events/42/response?wait=0` for a still-pending event
- **THEN** the server returns HTTP 408 immediately without waiting

#### Scenario: Idempotent re-poll after answer

- **WHEN** an agent successfully receives a response, the network drops the response body, and the agent re-issues `GET /events/42/response?wait=30`
- **THEN** the server again returns HTTP 200 with the same response body

#### Scenario: Event not found

- **WHEN** the agent calls `GET /events/99999/response` for an event id that does not exist
- **THEN** the server responds HTTP 404 with `{ error: "Event not found" }`

#### Scenario: Event has no HITL block

- **WHEN** the agent calls `GET /events/:id/response` for an event whose `human_in_the_loop` is null
- **THEN** the server responds HTTP 400 with `{ error: "Event does not have a HITL request" }`

### Requirement: Polling waiter wake-up

The server SHALL maintain a per-process registry mapping event ids to in-flight long-poll resolvers. When `POST /events/:id/respond` updates `human_in_the_loop_status` to `responded` (or `error`), the server SHALL wake every registered resolver for that event id within 50ms. The registry SHALL be cleaned up when long-polls complete (response delivered, timeout, or client disconnect) so that abandoned polls do not retain references.

#### Scenario: Multiple concurrent polls woken simultaneously

- **WHEN** two agents are long-polling the same event id (e.g. an agent and a retrying duplicate) and a human posts a response
- **THEN** both pollers receive HTTP 200 with the same response body within 50ms of the human's POST

#### Scenario: Client disconnect cleans up waiter

- **WHEN** an agent opens a long-poll, then closes the connection before the response arrives
- **THEN** the server removes the resolver from the waiter registry; subsequent successful responses for that event do not attempt to write to the closed connection

#### Scenario: Server restart drops in-flight polls

- **WHEN** the server restarts while a long-poll is open
- **THEN** the connection is severed; the agent's next poll attempt receives the persisted response (if recorded) or starts a fresh wait

### Requirement: Polling response body contract stability

The server's `GET /events/:id/response` endpoint SHALL return a JSON body that is a stable, documented subset of `HumanInTheLoopResponse`. Specifically, for permission requests the body SHALL contain `{ "permission": true | false, ... }`, for question requests `{ "response": "..." }`, and for choice requests `{ "choice": "..." }`. Client libraries MAY rely on the presence of these fields to parse outcomes without inspecting the original event's `type`.

#### Scenario: Permission response body shape

- **WHEN** a human responds to a permission-type HITL event via `POST /events/:id/respond` with `{ "permission": true, "responded_by": "alice" }`
- **THEN** the polling endpoint `GET /events/:id/response` returns exactly the same JSON object as its 200 body

#### Scenario: Question response body shape

- **WHEN** a human responds with `{ "response": "use main branch" }`
- **THEN** the polling endpoint returns `{ "response": "use main branch", "responded_at": ... }`

#### Scenario: Choice response body shape

- **WHEN** a human responds with `{ "choice": "Vitest" }`
- **THEN** the polling endpoint returns `{ "choice": "Vitest", "responded_at": ... }`

