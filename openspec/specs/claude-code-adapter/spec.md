# Claude Code Adapter Specification

## Purpose
TBD


## Requirements

### Requirement: Single CLI entry point per hook

The adapter SHALL expose a single Python CLI executable (`apps/adapter-claude-code/send_event.py`) that handles all 12 Claude Code hook event types. The CLI SHALL be invoked once per hook firing, with the hook's JSON payload supplied on stdin and the hook's name supplied via the `--event-type` flag.

#### Scenario: CLI accepts hook payload via stdin

- **WHEN** the adapter is invoked with `--event-type PreToolUse` and a valid Claude Code hook JSON object piped to stdin
- **THEN** the adapter parses stdin, constructs a v1 envelope, and POSTs it to the configured echo server URL

#### Scenario: CLI rejects unknown event-type

- **WHEN** the adapter is invoked with `--event-type SomeMadeUpEvent`
- **THEN** the adapter writes an error to stderr naming the unrecognized event type and exits with status 0 (never blocks Claude Code)

#### Scenario: Missing stdin payload

- **WHEN** the adapter is invoked with no data on stdin or with malformed JSON
- **THEN** the adapter writes a structured warning to stderr and exits with status 0 without making any HTTP request

### Requirement: Hook event name to canonical event type mapping

The adapter SHALL map each Claude Code `HookEventName` to exactly one value from echo's `CANONICAL_EVENT_TYPES` vocabulary. The complete mapping SHALL be:

| `HookEventName` | `event_type` |
|---|---|
| `SessionStart` | `session.start` |
| `SessionEnd` | `session.end` |
| `UserPromptSubmit` | `user.prompt.submit` |
| `PreToolUse` | `tool.pre_use` |
| `PostToolUse` | `tool.post_use` |
| `PostToolUseFailure` | `tool.failure` |
| `Notification` | `agent.notification` |
| `Stop` | `agent.stop` |
| `PreCompact` | `agent.precompact` |
| `SubagentStart` | `subagent.start` |
| `SubagentStop` | `subagent.stop` |
| `PermissionRequest` | `tool.pre_use` |

The adapter SHALL preserve the original Claude Code hook name in `raw_event_type` exactly as supplied via `--event-type`.

#### Scenario: Standard hook mapping

- **WHEN** the adapter is invoked with `--event-type PreToolUse`
- **THEN** the constructed envelope has `event_type: "tool.pre_use"` and `raw_event_type: "PreToolUse"`

#### Scenario: PermissionRequest folds into tool.pre_use

- **WHEN** the adapter is invoked with `--event-type PermissionRequest`
- **THEN** the constructed envelope has `event_type: "tool.pre_use"` and `raw_event_type: "PermissionRequest"`, allowing dashboards to distinguish via `raw_event_type`

#### Scenario: Every emitted event_type is canonical

- **WHEN** the adapter constructs envelopes for all 12 supported hook event names
- **THEN** every `event_type` value emitted is a member of echo's `CANONICAL_EVENT_TYPES` vocabulary

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

### Requirement: Configuration resolution

The adapter SHALL resolve the echo server URL and `source_app` value in the following priority order:

1. CLI flag (`--server-url`, `--source-app`) if provided.
2. Environment variable (`ECHO_SERVER_URL`, `ECHO_SOURCE_APP`) if set.
3. For `--server-url` only: hardcoded default `http://localhost:4000`.

If `source_app` cannot be resolved by either CLI flag or environment variable, the adapter SHALL exit with status 0 and write a structured stderr warning naming the missing configuration.

#### Scenario: CLI flag overrides environment

- **WHEN** the adapter is invoked with both `--source-app cli-value` and `ECHO_SOURCE_APP=env-value` in the environment
- **THEN** the constructed envelope's `source_app` is `"cli-value"`

#### Scenario: Environment variable used when no CLI flag

- **WHEN** the adapter is invoked without `--source-app` but with `ECHO_SOURCE_APP=my-backend` in the environment
- **THEN** the constructed envelope's `source_app` is `"my-backend"`

#### Scenario: Server URL defaults to localhost

- **WHEN** the adapter is invoked without `--server-url` and without `ECHO_SERVER_URL` in the environment
- **THEN** the adapter POSTs to `http://localhost:4000/events`

#### Scenario: Missing source_app

- **WHEN** the adapter is invoked without `--source-app` and without `ECHO_SOURCE_APP` in the environment
- **THEN** the adapter writes a stderr warning naming the missing configuration, makes no HTTP request, and exits with status 0

### Requirement: Fail-safe network behavior

The adapter SHALL never block, retry, or surface errors that could disrupt the user's Claude Code session. If the POST to echo fails for any reason (network error, non-2xx HTTP status, timeout exceeding 5 seconds, DNS failure), the adapter SHALL:

1. Write a single-line structured warning to stderr identifying the failure mode.
2. Exit with status 0.

The adapter SHALL NOT buffer events to disk, SHALL NOT spawn background processes for retry, and SHALL NOT raise unhandled exceptions to its caller.

#### Scenario: Echo server unreachable

- **WHEN** the adapter is invoked while the echo server is not running
- **THEN** the adapter writes a stderr warning indicating connection failure and exits with status 0 within 6 seconds

#### Scenario: Echo server returns 500

- **WHEN** the adapter POSTs and the server responds with HTTP 500
- **THEN** the adapter writes a stderr warning naming the status code and exits with status 0

#### Scenario: Echo server returns 200

- **WHEN** the adapter POSTs and the server responds with HTTP 200
- **THEN** the adapter exits with status 0 silently (no stderr output)

#### Scenario: Adapter exception path

- **WHEN** an unexpected exception occurs during envelope construction (e.g. corrupted transcript file)
- **THEN** the adapter catches the exception, writes a stderr warning, and exits with status 0
