## Why

The echo server has full HITL infrastructure (POST /events with human_in_the_loop, POST /events/:id/respond, GET /events/:id/response polling endpoint) but no Python client library that hook code or agent code can use to send a HITL request and block until a human responds. In a multi-agent workflow (multiple Claude Code sessions running in parallel), users cannot monitor every terminal — they need a single dashboard as the control point. A lightweight Python helper lets any hook or script post a HITL envelope and long-poll for the human's decision, turning the WebGL dashboard into the sole approval surface for all running agents.

## What Changes

- Add `apps/hitl-helper-python/` — a stdlib-only Python module (`echo_hitl.py`) exposing `ask_permission()`, `ask_question()`, and `ask_choice()`.
- Each function assembles a v1 `EventEnvelope` with `human_in_the_loop` block and `callback: { kind: "polling" }`, POSTs it to echo, then long-polls `GET /events/:id/response` until a human responds or timeout elapses.
- Provide a typed outcome enum distinguishing granted/denied/timeout/error (not just bool).
- Include a convenience CLI mode (`python -m echo_hitl --permission "Delete /tmp?"`) for quick testing.
- Provide integration example showing usage inside a Claude Code `pre_tool_use` hook to gate dangerous tool calls via the dashboard instead of the terminal.

Out of scope:
- WebSocket callback mode (polling only — covers the NAT/cloud case).
- Async API (sync blocking is sufficient for hook processes and simple scripts).
- pip package distribution (lives in-repo for now).

## Capabilities

### New Capabilities
- `hitl-helper`: Python client library for sending HITL requests to echo and awaiting human responses via long-poll. Covers envelope assembly, HTTP transport, poll loop, and outcome parsing.

### Modified Capabilities
- `human-in-the-loop`: Add requirement that polling callback events can be created by external client libraries (not just raw curl), and that the server's response body contract is stable enough for a typed client.

## Impact

- **New code**: `apps/hitl-helper-python/` (echo_hitl.py, pyproject.toml, tests/, examples/).
- **No server changes**: uses existing `POST /events` and `GET /events/:id/response` endpoints unchanged.
- **No envelope changes**: uses existing `HitlCallback: { kind: "polling" }` variant.
- **External dependency**: none — stdlib only (`urllib.request`, `json`, `time`, `enum`).
- **Integration surface**: hook code imports `echo_hitl` and calls `ask_permission()`, then uses the result to print `permissionDecision: allow/deny` JSON. The hook's `session_id` (from stdin) flows directly into the envelope, ensuring dashboard event streams align.
