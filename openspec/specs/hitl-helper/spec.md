# hitl-helper Specification

## Purpose
TBD - created by archiving change hitl-helper-python. Update Purpose after archive.
## Requirements
### Requirement: Permission request via polling transport

The `ask_permission()` function SHALL accept a question string and connection parameters (`source_app`, `session_id`, `server_url`, `agent_kind`, `timeout`), POST a v1 `EventEnvelope` with `human_in_the_loop` block and `callback: { kind: "polling" }` to the echo server, then long-poll `GET /events/:id/response` until a human responds or the timeout elapses. The function SHALL return a `HitlOutcome` enum value.

#### Scenario: Human grants permission

- **WHEN** `ask_permission("Delete /tmp?", source_app="app", session_id="s1")` is called and a human responds with `{"permission": true}` via the dashboard
- **THEN** the function returns `HitlOutcome.GRANTED`

#### Scenario: Human denies permission

- **WHEN** `ask_permission("Delete /tmp?", source_app="app", session_id="s1")` is called and a human responds with `{"permission": false}` via the dashboard
- **THEN** the function returns `HitlOutcome.DENIED`

#### Scenario: Timeout with no response

- **WHEN** `ask_permission("Delete /tmp?", source_app="app", session_id="s1", timeout=10)` is called and no human responds within 10 seconds
- **THEN** the function returns `HitlOutcome.TIMEOUT`

#### Scenario: Server unreachable

- **WHEN** `ask_permission(...)` is called but the echo server is not running
- **THEN** the function returns `HitlOutcome.ERROR` within 5 seconds (POST timeout)

### Requirement: Question request via polling transport

The `ask_question()` function SHALL accept a question string and connection parameters, POST a HITL envelope with `type: "question"`, and long-poll for the response. It SHALL return the human's free-text response string on success, or `None` on timeout/error.

#### Scenario: Human answers a question

- **WHEN** `ask_question("What branch?", source_app="app", session_id="s1")` is called and a human responds with `{"response": "main"}`
- **THEN** the function returns `"main"`

#### Scenario: Question times out

- **WHEN** `ask_question("What branch?", source_app="app", session_id="s1", timeout=5)` is called and no response arrives within 5 seconds
- **THEN** the function returns `None`

### Requirement: Choice request via polling transport

The `ask_choice()` function SHALL accept a question string, a list of choices, and connection parameters. It SHALL POST a HITL envelope with `type: "choice"` and the choices array, then long-poll for the response. It SHALL return the selected choice string on success, or `None` on timeout/error.

#### Scenario: Human selects a choice

- **WHEN** `ask_choice("Framework?", ["Jest", "Vitest"], source_app="app", session_id="s1")` is called and a human responds with `{"choice": "Vitest"}`
- **THEN** the function returns `"Vitest"`

#### Scenario: Choice times out

- **WHEN** no response arrives within the timeout
- **THEN** the function returns `None`

### Requirement: Typed outcome enum

The module SHALL export a `HitlOutcome` enum with exactly four members: `GRANTED`, `DENIED`, `TIMEOUT`, `ERROR`. This enum SHALL be the return type of `ask_permission()`. The `ask_question()` and `ask_choice()` functions SHALL return `str | None` (where `None` covers both timeout and error cases).

#### Scenario: All enum members accessible

- **WHEN** a caller imports `from echo_hitl import HitlOutcome`
- **THEN** `HitlOutcome.GRANTED`, `HitlOutcome.DENIED`, `HitlOutcome.TIMEOUT`, and `HitlOutcome.ERROR` are all valid enum members

### Requirement: Envelope assembly

The module SHALL construct a valid v1 `EventEnvelope` with: `envelope_version: 1`, `agent_kind` (default `"claude-code"`), `agent_version: "0.1.0"`, `source_app`, `session_id`, `event_type: "hitl.request"`, `raw_event_type: "HumanInTheLoop"`, `timestamp` (current ms epoch), `payload: {}`, and `human_in_the_loop` block containing `question`, `type`, optional `choices`, `timeout`, and `callback: { kind: "polling" }`.

#### Scenario: Envelope validates against server

- **WHEN** the module POSTs the assembled envelope to `POST /events`
- **THEN** the server accepts it with HTTP 201 and persists `human_in_the_loop_status: { status: "pending" }`

#### Scenario: Polling callback has no URL

- **WHEN** the envelope is assembled
- **THEN** the `human_in_the_loop.callback` field is exactly `{ "kind": "polling" }` with no `url` or other transport fields

### Requirement: Stdlib-only implementation

The module SHALL use only Python standard library modules (`urllib.request`, `json`, `time`, `enum`, `typing`). It SHALL NOT import any third-party packages at runtime.

#### Scenario: Import succeeds in bare Python environment

- **WHEN** `from echo_hitl import ask_permission` is executed in a Python 3.10+ environment with no pip packages installed
- **THEN** the import succeeds without `ImportError`

### Requirement: CLI mode for testing

The module SHALL be executable via `python -m echo_hitl` (or `python echo_hitl.py`) with CLI flags `--permission`, `--question`, or `--choice` to send a HITL request and print the outcome to stdout. This mode is for manual testing and smoke tests.

#### Scenario: CLI permission request

- **WHEN** `python echo_hitl.py --permission "Allow deploy?" --source-app test --session-id s1` is executed with echo server running
- **THEN** the script posts a permission HITL event, polls for response, and prints the outcome enum value to stdout before exiting

