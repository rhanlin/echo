# hitl-helper-python

A stdlib-only Python module (`echo_hitl.py`) for sending human-in-the-loop requests to the echo observability server and blocking until a human responds via the dashboard.

## Overview

In a multi-agent workflow (multiple Claude Code sessions running in parallel) users cannot monitor every terminal.  This helper lets any hook or script post a HITL envelope to echo and long-poll for the human's decision, turning the WebGL dashboard into the sole approval surface for all running agents.

## Requirements

- Python 3.10+
- A running [echo server](../../apps/server/)
- No pip dependencies (stdlib only)

## Import path setup

Since this is not a published package, add the directory to `sys.path` before importing:

```python
import sys
sys.path.insert(0, "/path/to/apps/hitl-helper-python")
from echo_hitl import ask_permission, ask_question, ask_choice, HitlOutcome
```

## Basic usage

### Ask for permission (yes/no)

```python
from echo_hitl import ask_permission, HitlOutcome

outcome = ask_permission(
    "Allow deployment to production?",
    source_app="my-deployment-agent",
    session_id="session-abc123",
    server_url="http://localhost:4000",  # default
    timeout=300,                         # seconds, default
)

match outcome:
    case HitlOutcome.GRANTED:
        deploy()
    case HitlOutcome.DENIED:
        abort("Human rejected the deployment.")
    case HitlOutcome.TIMEOUT:
        abort("No response within timeout — aborting for safety.")
    case HitlOutcome.ERROR:
        abort("Could not reach dashboard — aborting for safety.")
```

### Ask a free-text question

```python
from echo_hitl import ask_question

branch = ask_question(
    "Which branch should I merge into?",
    source_app="my-agent",
    session_id="session-abc123",
)
if branch is None:
    # timeout or error
    branch = "main"
```

### Ask a multiple-choice question

```python
from echo_hitl import ask_choice

framework = ask_choice(
    "Which test framework should I use?",
    choices=["Jest", "Vitest", "Mocha"],
    source_app="my-agent",
    session_id="session-abc123",
)
```

## HitlOutcome enum

| Member | Value | Meaning |
|---|---|---|
| `GRANTED` | `"granted"` | Human approved the request |
| `DENIED` | `"denied"` | Human rejected the request |
| `TIMEOUT` | `"timeout"` | No response within the timeout |
| `ERROR` | `"error"` | Server unreachable or unexpected response |

**Recommended pattern for safety:** treat both `TIMEOUT` and `ERROR` as deny.

## Hook integration pattern

See [`examples/hook_gate.py`](examples/hook_gate.py) for a complete `pre_tool_use` hook example.

The hook reads `session_id` from the Claude Code stdin JSON, calls `ask_permission()`, and outputs `permissionDecision: allow/deny` based on the outcome.

Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "uv run /path/to/apps/hitl-helper-python/examples/hook_gate.py"
          }
        ]
      }
    ]
  }
}
```

Environment variables:

| Variable | Default | Description |
|---|---|---|
| `ECHO_SOURCE_APP` | `"claude-code"` | Source app label in the dashboard |
| `ECHO_SERVER_URL` | `"http://localhost:4000"` | Echo server URL |
| `ECHO_HITL_TIMEOUT` | `"300"` | Timeout in seconds |

## CLI testing

Test against a running server directly from the command line:

```bash
# Permission request
python echo_hitl.py --permission "Allow deploy?" \
  --source-app test --session-id s1

# Free-text question
python echo_hitl.py --question "What branch?" \
  --source-app test --session-id s1

# Multiple-choice
python echo_hitl.py --choice "Which framework?" \
  --choices "Jest,Vitest,Mocha" \
  --source-app test --session-id s1
```

Then respond via curl:

```bash
# Get the event ID first
curl -s http://localhost:4000/events | jq '.[0].id'

# Respond (permission)
curl -X POST http://localhost:4000/events/1/respond \
  -H "Content-Type: application/json" \
  -d '{"permission": true}'
```

## Running tests

```bash
cd apps/hitl-helper-python

# Unit tests only (no server required)
pytest tests/test_echo_hitl.py -v

# Integration tests (requires running echo server)
pytest tests/test_integration.py -v

# All tests
pytest -v
```
