## 1. Module scaffolding

- [x] 1.1 Create `apps/hitl-helper-python/` directory with `pyproject.toml` (name: `echo-hitl`, requires-python >=3.10, no runtime dependencies, dev dep: pytest).
- [x] 1.2 Create `apps/hitl-helper-python/echo_hitl.py` with module docstring, imports (`json`, `enum`, `time`, `urllib.request`, `urllib.error`, `typing`), and the `HitlOutcome` enum (GRANTED, DENIED, TIMEOUT, ERROR).

## 2. HTTP helpers

- [x] 2.1 Implement `_post_json(url, body, timeout=5) -> tuple[int, dict | None]` — POST JSON via `urllib.request`, return (status_code, parsed_body). Catch all exceptions and return (0, None) on failure.
- [x] 2.2 Implement `_get_json(url, timeout) -> tuple[int, dict | None]` — GET with timeout, return (status_code, parsed_body). Return (0, None) on failure.

## 3. Envelope assembly

- [x] 3.1 Implement `_build_envelope(question, hitl_type, choices, source_app, session_id, agent_kind, timeout) -> dict` — construct a valid v1 EventEnvelope with `human_in_the_loop` block and `callback: {kind: "polling"}`.
- [x] 3.2 Unit test: assert the built envelope has all required top-level fields and a valid `human_in_the_loop` structure.

## 4. Poll loop

- [x] 4.1 Implement `_poll_response(event_id, server_url, timeout) -> tuple[HitlOutcome, dict | None]` — loop calling `GET /events/{id}/response?wait=30` until 200, timeout, or error.
- [x] 4.2 Unit test: mock HTTP to return 408 twice then 200 — assert function returns the parsed body.
- [x] 4.3 Unit test: mock HTTP to return 408 until deadline passes — assert returns `(TIMEOUT, None)`.

## 5. Public API functions

- [x] 5.1 Implement `ask_permission(question, *, source_app, session_id, agent_kind="claude-code", server_url="http://localhost:4000", timeout=300) -> HitlOutcome`.
- [x] 5.2 Implement `ask_question(question, *, source_app, session_id, agent_kind="claude-code", server_url="http://localhost:4000", timeout=300) -> str | None`.
- [x] 5.3 Implement `ask_choice(question, choices, *, source_app, session_id, agent_kind="claude-code", server_url="http://localhost:4000", timeout=300) -> str | None`.
- [x] 5.4 Unit test: `ask_permission` with mocked POST (201, id=1) + mocked poll (200, `{permission: true}`) → returns `GRANTED`.
- [x] 5.5 Unit test: `ask_permission` with mocked POST (201, id=1) + mocked poll (200, `{permission: false}`) → returns `DENIED`.
- [x] 5.6 Unit test: `ask_permission` with mocked POST failure → returns `ERROR`.
- [x] 5.7 Unit test: `ask_question` with mocked poll (200, `{response: "main"}`) → returns `"main"`.
- [x] 5.8 Unit test: `ask_choice` with mocked poll (200, `{choice: "Vitest"}`) → returns `"Vitest"`.

## 6. CLI mode

- [x] 6.1 Add `if __name__ == "__main__"` block with argparse: `--permission`, `--question`, `--choice` (mutually exclusive), plus `--source-app`, `--session-id`, `--server-url`, `--timeout`, `--choices` (comma-separated for choice mode).
- [x] 6.2 Manual test: run `python echo_hitl.py --permission "test?" --source-app demo --session-id s1` against a running echo server, respond via curl, confirm output.

## 7. Integration example

- [x] 7.1 Create `apps/hitl-helper-python/examples/hook_gate.py` — a minimal `pre_tool_use` hook that imports `echo_hitl`, calls `ask_permission()` for dangerous commands, and outputs `permissionDecision: allow/deny`.
- [x] 7.2 Add usage instructions in `apps/hitl-helper-python/README.md` covering: import path setup, basic usage, hook integration pattern, CLI testing, and `HitlOutcome` handling.

## 8. Integration tests

- [x] 8.1 Integration test: start echo server, call `ask_permission()` in one thread, POST respond in another thread after 100ms, assert `GRANTED` returned.
- [x] 8.2 Integration test: start echo server, call `ask_permission(timeout=2)` with no responder, assert `TIMEOUT` returned within ~2.5s.
- [x] 8.3 Integration test: call `ask_permission()` with no server running, assert `ERROR` returned within ~6s.

## 9. Verification

- [x] 9.1 Run `pytest` in `apps/hitl-helper-python/` — all unit tests pass.
- [x] 9.2 Run integration tests — all pass.
- [x] 9.3 Verify `from echo_hitl import ask_permission, HitlOutcome` works with no pip dependencies in a clean Python 3.10+ environment.
- [x] 9.4 Run `openspec validate hitl-helper-python --strict` — no errors.
