## ADDED Requirements

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
