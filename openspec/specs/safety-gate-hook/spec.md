# Safety Gate Hook Specification

## Requirements

### Requirement: Hard-deny blacklist for catastrophic Bash commands

The safety gate hook SHALL maintain a configurable list of regex patterns (`BLACKLIST_PATTERNS`) representing commands that are never permitted under any circumstance. When a `PreToolUse` event for `Bash` matches any blacklist pattern, the hook SHALL emit a `permissionDecision: "deny"` JSON to stdout with reason `"safety-gate: blacklisted command"` and exit 0, without consulting any human.

The default blacklist SHALL include patterns matching at minimum: `rm -rf /`, `rm -rf /*`, `rm -rf ~`, `rm -rf ~/`, `rm -rf $HOME`, `rm -rf .`, `rm -rf *` (recognising common `rm` flag combinations like `-rf`, `-fr`, `-Rf`, `--recursive --force`).

#### Scenario: Literal root deletion attempt is blocked locally

- **GIVEN** a Claude agent invokes the `Bash` tool with command `rm -rf /`
- **WHEN** `safety_gate.py` receives the `PreToolUse` event
- **THEN** the hook MUST exit 0 with stdout containing JSON `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "safety-gate: blacklisted command"}}`
- **AND** no HTTP request to the echo server SHALL be made
- **AND** the elapsed time SHALL be under 100ms

#### Scenario: Home directory deletion attempt is blocked locally

- **GIVEN** the agent invokes `Bash` with command `rm -rf $HOME` or `rm -rf ~/`
- **WHEN** the hook processes the event
- **THEN** the hook MUST emit a deny decision without invoking HITL

---

### Requirement: Graylist commands are routed to the dashboard via HITL

The hook SHALL classify any `rm -rf <path>` command that is NOT in the blacklist AND whose target path is NOT under any directory listed in `ALLOWED_RM_DIRECTORIES` as a graylist command. For graylist commands, the hook SHALL call `echo_hitl.ask_permission()` with a question describing the exact command, and SHALL block until either a human decision is received or the timeout elapses.

The hook SHALL pass `source_app="claude-code"` (or the value of `$ECHO_HITL_SOURCE_APP` if set) and `session_id` from the hook's input payload to `ask_permission()`.

#### Scenario: Graylist command waits for human approval

- **GIVEN** the agent invokes `Bash` with `rm -rf /tmp/build-output`
- **AND** `/tmp/build-output` is not under `ALLOWED_RM_DIRECTORIES`
- **WHEN** `safety_gate.py` processes the event
- **THEN** the hook MUST POST a HITL envelope to the echo server with payload describing the command
- **AND** the hook MUST long-poll `GET /events/:id/response` until a decision arrives
- **AND** if the human responds with `granted: true`, the hook MUST exit 0 with no stdout (allow)
- **AND** if the human responds with `granted: false`, the hook MUST emit `permissionDecision: "deny"` with reason `"safety-gate: human denied"` and exit 0

#### Scenario: Allowlisted directory bypasses HITL

- **GIVEN** `ALLOWED_RM_DIRECTORIES` contains `"trees/"`
- **AND** the agent invokes `Bash` with `rm -rf trees/feature-x`
- **WHEN** the hook processes the event
- **THEN** the hook MUST exit 0 with no stdout (allow) without invoking HITL
- **AND** no HTTP request SHALL be made

---

### Requirement: Fail-closed on HITL error or timeout

When `echo_hitl.ask_permission()` returns `HitlOutcome.TIMEOUT`, `HitlOutcome.ERROR`, or `HitlOutcome.DENIED`, the hook SHALL emit a `permissionDecision: "deny"` JSON to stdout. The reason field SHALL include the outcome name (e.g. `"safety-gate: timeout"`, `"safety-gate: error - <details>"`, `"safety-gate: human denied"`).

The hook SHALL NOT allow the tool to proceed under any error condition involving the HITL flow.

#### Scenario: Echo server unreachable defaults to deny

- **GIVEN** the echo server is offline (connection refused on POST `/events`)
- **AND** the agent invokes `Bash` with a graylist command `rm -rf /tmp/foo`
- **WHEN** the hook attempts `ask_permission()`
- **THEN** `ask_permission()` SHALL return `HitlOutcome.ERROR`
- **AND** the hook MUST emit `permissionDecision: "deny"` with a reason mentioning the error
- **AND** the hook MUST exit 0 (not crash)

#### Scenario: Human does not respond within timeout

- **GIVEN** a graylist command is sent to HITL with `ECHO_HITL_TIMEOUT=5`
- **WHEN** no human responds within 5 seconds
- **THEN** `ask_permission()` SHALL return `HitlOutcome.TIMEOUT`
- **AND** the hook MUST emit `permissionDecision: "deny"` with reason `"safety-gate: timeout"`

---

### Requirement: Configurable patterns and timeout

`BLACKLIST_PATTERNS`, `GRAYLIST_PATTERNS`, and `ALLOWED_RM_DIRECTORIES` SHALL be defined as module-level constants at the top of `safety_gate.py` such that they can be edited in a single place without parsing external files.

The HITL timeout SHALL be read from environment variable `ECHO_HITL_TIMEOUT` (an integer, seconds), with default value 60 if unset or invalid.

The echo server URL SHALL be read from environment variable `ECHO_SERVER_URL`, with default `http://127.0.0.1:4000`.

#### Scenario: Custom timeout via env var is honoured

- **GIVEN** environment variable `ECHO_HITL_TIMEOUT=120` is set
- **WHEN** the hook calls `ask_permission()` for a graylist command
- **THEN** the timeout passed to `ask_permission()` MUST be 120

#### Scenario: Invalid env var falls back to default

- **GIVEN** environment variable `ECHO_HITL_TIMEOUT=not-a-number` is set
- **WHEN** the hook reads the timeout
- **THEN** the hook MUST use the default value 60 (not crash)

---

### Requirement: Safe command passthrough is fast and silent

For Bash commands matching neither blacklist nor graylist patterns, AND for non-Bash tool invocations, the hook SHALL exit 0 with no stdout in under 50ms (no HTTP requests).

#### Scenario: ls command passes through untouched

- **GIVEN** the agent invokes `Bash` with `ls -la`
- **WHEN** the hook processes the event
- **THEN** the hook MUST exit 0 with empty stdout
- **AND** elapsed time MUST be under 50ms
- **AND** no HTTP request SHALL be made

#### Scenario: Non-Bash tool is ignored

- **GIVEN** the agent invokes `Read` with file path `/etc/passwd`
- **WHEN** the hook processes the event
- **THEN** the hook MUST exit 0 with empty stdout (Bash-only gate in v1)

---

### Requirement: Hook is registered in agents-observe settings.json

`agents-observe/.claude/settings.json` SHALL include `safety_gate.py` as an entry in the `PreToolUse` hook array with matcher `"Bash"`, running in parallel with the existing `send_event.py` entry.

The entry SHALL invoke the hook via `uv run --script` (consistent with other Python hooks in the same file) with the script path resolved using `$CLAUDE_PROJECT_DIR`.

#### Scenario: settings.json contains the hook entry

- **GIVEN** `agents-observe/.claude/settings.json`
- **WHEN** the file is parsed as JSON
- **THEN** `hooks.PreToolUse` MUST contain at least one entry whose `matcher` is `"Bash"` and whose `hooks[].command` references `safety_gate.py`
- **AND** the existing `send_event.py` PreToolUse entry MUST remain unchanged

---

### Requirement: Hook resolves echo_hitl via CLAUDE_PROJECT_DIR

The hook SHALL locate `echo_hitl.py` by joining `$CLAUDE_PROJECT_DIR` (falling back to `os.getcwd()` if unset) with `apps/hitl-helper-python/` and inserting that path into `sys.path` before importing `echo_hitl`.

If the import fails (module not found), the hook SHALL emit `permissionDecision: "deny"` with reason `"safety-gate: echo_hitl not available"` for any graylist command, and SHALL still allow safe (non-matching) commands to pass through.

#### Scenario: Missing echo_hitl denies graylist but allows safe commands

- **GIVEN** `apps/hitl-helper-python/echo_hitl.py` does not exist
- **WHEN** the hook processes a graylist command
- **THEN** the hook MUST emit deny with reason `"safety-gate: echo_hitl not available"`
- **WHEN** the hook processes a safe command (e.g. `ls`)
- **THEN** the hook MUST exit 0 with empty stdout (allow)
