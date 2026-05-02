## MODIFIED Requirements

### Requirement: Human-in-the-loop is an envelope property

When an event requires a blocking human response, the envelope SHALL include `human_in_the_loop` with: `question` (string), `type` (`question | permission | choice`), an optional `choices` array (required when `type` is `choice`), an optional `timeout` (seconds), and `callback`. `callback.kind` SHALL be exactly one of `websocket`, `webhook`, or `polling`. Pure notifications that do not block the agent SHALL NOT use HITL — they SHALL use `event_type: "agent.notification"` instead.

The `callback` field SHALL be a discriminated union keyed by `kind`:
- For `kind: "websocket"`, the callback SHALL include a `url` (`ws://` or `wss://`).
- For `kind: "webhook"`, the callback SHALL include a `url` (`http://` or `https://`) and MAY include a `method` (default `"POST"`).
- For `kind: "polling"`, only the `kind` field is required; no `url` or transport fields are needed because the agent retrieves the response by polling `GET /events/:id/response`.

#### Scenario: Polling kind accepted

- **WHEN** an envelope with `human_in_the_loop.callback: { "kind": "polling" }` is POSTed
- **THEN** the envelope is accepted as structurally valid

#### Scenario: Polling kind ignores extra fields

- **WHEN** an envelope with `human_in_the_loop.callback: { "kind": "polling", "url": "ignored" }` is POSTed
- **THEN** the envelope is accepted; the extra `url` field is preserved verbatim in the persisted record but has no effect on response delivery

#### Scenario: Unknown callback kind rejected

- **WHEN** an envelope with `human_in_the_loop.callback: { "kind": "carrier-pigeon" }` is POSTed
- **THEN** the server responds HTTP 400 naming the invalid `kind`
