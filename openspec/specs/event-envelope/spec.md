## ADDED Requirements

### Requirement: Envelope top-level shape

The system SHALL define a single `EventEnvelope` v1 contract that every adapter MUST produce when posting events. The envelope SHALL use snake_case field names. The envelope MUST include the following required fields: `envelope_version`, `agent_kind`, `agent_version`, `source_app`, `session_id`, `event_type`, `raw_event_type`, and `payload`. All other fields SHALL be optional.

#### Scenario: Required fields present

- **WHEN** an adapter posts an envelope containing all eight required fields with valid types
- **THEN** the envelope is considered structurally valid and is accepted by the server

#### Scenario: Missing required field

- **WHEN** an adapter posts an envelope missing any of the eight required fields
- **THEN** the server rejects the request with HTTP 400 and a message naming the missing field

#### Scenario: Field naming convention

- **WHEN** an envelope uses camelCase field names (e.g. `agentKind`, `sessionId`)
- **THEN** the server treats those fields as absent and rejects the envelope with HTTP 400

### Requirement: Envelope versioning

The envelope SHALL carry an integer `envelope_version` starting at `1`. The version SHALL increment only on breaking changes. Backward-compatible additions (new optional fields) SHALL NOT bump the version. The server SHALL accept only envelopes whose `envelope_version` it understands.

#### Scenario: Current version accepted

- **WHEN** an envelope with `envelope_version: 1` is posted
- **THEN** the server processes it normally

#### Scenario: Unknown version rejected

- **WHEN** an envelope with `envelope_version: 2` is posted to a v1 server
- **THEN** the server rejects the request with HTTP 400 and a message indicating an unsupported envelope version

### Requirement: Agent identity fields

The envelope SHALL identify the originating agent via two fields: `agent_kind` (free string, e.g. `claude-code`, `gemini-cli`, `codex`, `cursor`) and `agent_version` (adapter's self-reported version string). Together with `source_app` and `session_id`, these identify a unique agent run.

#### Scenario: Identity fields persisted

- **WHEN** an envelope is accepted by the server
- **THEN** the persisted record retains `agent_kind`, `agent_version`, `source_app`, and `session_id` exactly as received

#### Scenario: Empty identity field

- **WHEN** any of `agent_kind`, `agent_version`, `source_app`, or `session_id` is an empty string
- **THEN** the server rejects the envelope with HTTP 400

### Requirement: Normalized event type vocabulary

The envelope SHALL include `event_type` (normalized) and `raw_event_type` (original native event name). The system SHALL publish a canonical vocabulary `CANONICAL_EVENT_TYPES` containing at least: `session.start`, `session.end`, `user.prompt.submit`, `tool.pre_use`, `tool.post_use`, `tool.failure`, `agent.notification`, `agent.stop`, `agent.precompact`, `subagent.start`, `subagent.stop`, `unknown`. Adapters SHOULD select an `event_type` from the vocabulary or use `unknown`. The server SHALL accept any non-empty string for `event_type`.

#### Scenario: Canonical event type

- **WHEN** an envelope arrives with `event_type` matching a canonical value (e.g. `tool.pre_use`)
- **THEN** the server accepts and stores it without warning

#### Scenario: Non-canonical event type

- **WHEN** an envelope arrives with `event_type` not in the canonical list (e.g. `tool.preuse`)
- **THEN** the server accepts and stores it but logs a warning naming the unrecognized value

#### Scenario: Raw event type preserved

- **WHEN** an envelope is stored
- **THEN** `raw_event_type` is retained exactly as supplied so adapter-native semantics are not lost

### Requirement: Payload, normalized fields, and transcript

The envelope SHALL carry the agent's original payload under `payload` (untouched JSON object) and MAY carry adapter-extracted convenience fields under `normalized` (object). Transcripts MAY be inlined under `transcript` (array) for terminal events such as `session.end`, or pointed to via `transcript_ref` (`{ kind: "file" | "url", location: string }`) for other cases.

#### Scenario: Payload preserved verbatim

- **WHEN** an envelope is stored and later retrieved
- **THEN** the `payload` object is returned bit-for-bit identical to what the adapter sent

#### Scenario: Optional normalized block

- **WHEN** an envelope omits `normalized`
- **THEN** the server accepts it and downstream consumers MUST treat normalized fields as absent rather than empty

### Requirement: Human-in-the-loop is an envelope property

When an event requires a blocking human response, the envelope SHALL include `human_in_the_loop` with: `question` (string), `type` (`question | permission | choice`), an optional `choices` array (required when `type` is `choice`), an optional `timeout` (seconds), and `callback`. `callback.kind` SHALL be exactly one of `websocket` or `webhook`. Pure notifications that do not block the agent SHALL NOT use HITL — they SHALL use `event_type: "agent.notification"` instead.

#### Scenario: Valid websocket callback

- **WHEN** an envelope contains `human_in_the_loop.callback` with `kind: "websocket"` and a valid `url`
- **THEN** the server accepts the envelope and persists the HITL block

#### Scenario: Invalid callback kind

- **WHEN** an envelope contains `human_in_the_loop.callback.kind` set to anything other than `websocket` or `webhook` (including `none`)
- **THEN** the server rejects the envelope with HTTP 400

#### Scenario: Choice type missing choices

- **WHEN** an envelope has `human_in_the_loop.type: "choice"` but no `choices` array
- **THEN** the server rejects the envelope with HTTP 400

### Requirement: Published JSON Schema

The system SHALL publish a JSON Schema (draft 2020-12) describing the envelope at `packages/envelope/envelope.schema.json`. The TypeScript types in `packages/envelope/types.ts` SHALL stay aligned with the JSON Schema, verified by a checked-in test that validates a corpus of valid and invalid example envelopes against both.

#### Scenario: Valid example passes both validators

- **WHEN** the test runs a valid example envelope through the JSON Schema validator and the server's inline validator
- **THEN** both validators accept it

#### Scenario: Invalid example fails both validators

- **WHEN** the test runs an invalid example envelope through both validators
- **THEN** both validators reject it with non-empty error output
