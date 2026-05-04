## MODIFIED Requirements

### Requirement: Envelope assembly from hook payload

The adapter SHALL construct a v1 `EventEnvelope` with the following derivations:

- `envelope_version`: `1` (constant)
- `agent_kind`: `"claude-code"` (constant)
- `agent_version`: adapter's self-reported version string (constant in source)
- `source_app`: resolved per the configuration requirement below
- `session_id`: read from stdin payload's `session_id` field; if missing, the adapter SHALL exit with status 0 and a stderr warning
- `event_type`: derived per the mapping table requirement
- `raw_event_type`: the value supplied via `--event-type`
- `payload`: the entire stdin JSON object, copied verbatim
- `timestamp`: an integer Unix epoch in milliseconds at the moment the envelope is constructed
- `normalized` (optional): MAY include any of the following extracted convenience fields, each populated only when the corresponding source key is present in `payload`; the block itself is omitted entirely when no field is extractable:
  - `tool_name` ← `payload.tool_name`
  - `cwd` ← `payload.cwd`
  - `model_name` ← extracted from `payload.transcript_path` within a fast (≤100ms) read budget; empty result is omitted
  - `user_prompt` ← `payload.prompt` (string)
  - `tool_input` ← `payload.tool_input` (object, copied as-is without mutation)
  - `tool_output` ← `payload.tool_response` (any JSON value, copied as-is)
  - `error` ← `{ message: payload.error }` when `payload.error` is a non-empty string
  - `notification_message` ← `payload.message` (string)

The adapter SHALL NOT add a `summary` field, SHALL NOT call any LLM API, and SHALL NOT mutate the original `payload` object before placing it in the envelope. Each normalized extraction SHALL be defensive: type mismatches (e.g. `payload.error` is not a string, `payload.tool_input` is not an object) cause that single field to be omitted but never fail the envelope.

#### Scenario: Payload preserved verbatim

- **WHEN** the adapter receives a hook payload with arbitrary keys (e.g. `tool_name`, `tool_input`, `cwd`, `permission_suggestions`)
- **THEN** the constructed envelope's `payload` field contains the exact same object byte-for-byte

#### Scenario: Missing session_id

- **WHEN** the stdin payload omits `session_id` or has `session_id: ""`
- **THEN** the adapter writes a stderr warning, makes no HTTP request, and exits with status 0

#### Scenario: Optional normalized fields populated

- **WHEN** the stdin payload includes `tool_name: "Bash"` and `cwd: "/repo"`
- **THEN** the constructed envelope has `normalized.tool_name: "Bash"` and `normalized.cwd: "/repo"`

#### Scenario: Optional normalized block omitted

- **WHEN** the stdin payload contains none of the fields the adapter knows how to extract
- **THEN** the constructed envelope omits the `normalized` field entirely (rather than sending an empty object)

#### Scenario: User prompt extracted from UserPromptSubmit

- **WHEN** the adapter is invoked with `--event-type UserPromptSubmit` and stdin contains `{"session_id": "s", "prompt": "What files are in this repo?", "cwd": "/repo"}`
- **THEN** the constructed envelope has `normalized.user_prompt: "What files are in this repo?"`

#### Scenario: Tool input extracted on PreToolUse

- **WHEN** the adapter is invoked with `--event-type PreToolUse` and stdin contains `{"session_id": "s", "tool_name": "Bash", "tool_input": {"command": "ls -la"}, "cwd": "/repo"}`
- **THEN** the constructed envelope has `normalized.tool_input` equal to `{"command": "ls -la"}` (deep equal, copied as-is)

#### Scenario: Tool output extracted on PostToolUse

- **WHEN** the adapter is invoked with `--event-type PostToolUse` and stdin contains `tool_response: {"output": "total 24\n..."}`
- **THEN** the constructed envelope has `normalized.tool_output` equal to `{"output": "total 24\n..."}`

#### Scenario: Error extracted on PostToolUseFailure

- **WHEN** the adapter is invoked with `--event-type PostToolUseFailure` and stdin contains `error: "cat: /nonexistent: No such file or directory"`
- **THEN** the constructed envelope has `normalized.error.message: "cat: /nonexistent: No such file or directory"` and no `normalized.error.code`

#### Scenario: Notification message extracted

- **WHEN** the adapter is invoked with `--event-type Notification` and stdin contains `message: "Claude needs your attention."`
- **THEN** the constructed envelope has `normalized.notification_message: "Claude needs your attention."`

#### Scenario: Defensive omission on type mismatch

- **WHEN** the adapter receives a stdin payload where `tool_input` is a string instead of an object, or `error` is an object instead of a string
- **THEN** that specific normalized field is omitted (other extractable fields and the envelope itself are unaffected; no exception is raised)

#### Scenario: Source payload is not mutated

- **WHEN** the adapter constructs an envelope whose `normalized.tool_input` is extracted from `payload.tool_input`
- **THEN** the original `payload` object retains `tool_input` unchanged, and modifying `normalized.tool_input` after the fact does not alter `payload.tool_input` (i.e. extraction does not share mutable state in a way that violates the verbatim-payload guarantee)
