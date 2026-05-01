## ADDED Requirements

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
