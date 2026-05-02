# Tasks — safety-gate-hook

## 1. Scaffolding

- [x] 1.1 Create directory `agents-observe/.claude/hooks/`
- [x] 1.2 Create file `agents-observe/.claude/hooks/safety_gate.py` with `uv run --script` shebang (PEP 723, stdlib only)
- [x] 1.3 Add module docstring describing purpose, env vars, exit contract
- [x] 1.4 Add module-level constants: `BLACKLIST_PATTERNS`, `GRAYLIST_PATTERNS`, `ALLOWED_RM_DIRECTORIES`, `DEFAULT_TIMEOUT = 60`, `DEFAULT_SERVER_URL = "http://127.0.0.1:4000"`

## 2. Pattern detection

- [x] 2.1 Implement `_normalize(command)` + `_matches_any(normalized, patterns)` helpers (regex applied with `re.search`, normalization lowercases & collapses whitespace)
- [x] 2.2 Implement `_is_blacklisted(command: str) -> bool` returning `True` if any blacklist pattern matches
- [x] 2.3 Implement `_extract_rm_targets(command: str) -> list[str]` that returns the path arguments of an `rm` invocation (empty list if not an rm command)
- [x] 2.4 Implement `_all_targets_allowed(command, allowed_dirs) -> bool` — true if every extracted target starts with an allowed directory prefix
- [x] 2.5 Implement `_classify(command: str) -> str` returning `"safe" | "graylist" | "blacklist"` combining the above

## 3. Hook output helpers

- [x] 3.1 Implement `_emit_deny(reason: str) -> None` that prints the Claude Code deny JSON and returns (caller exits 0)
- [x] 3.2 Allow path is silent — `main()` simply returns without writing to stdout (no `_emit_allow` helper needed)
- [x] 3.3 Implement `_read_input() -> dict` that reads JSON from stdin and returns parsed dict (return `{}` on parse error)

## 4. echo_hitl integration

- [x] 4.1 Implement `_load_echo_hitl()` that injects `$CLAUDE_PROJECT_DIR/apps/hitl-helper-python` into `sys.path` and returns `(ask_permission, HitlOutcome)` or `(None, None)` on ImportError
- [x] 4.2 Implement `_get_timeout() -> int` that reads `ECHO_HITL_TIMEOUT`, returns int, falls back to `DEFAULT_TIMEOUT` on missing/invalid
- [x] 4.3 Implement `_get_server_url() -> str` that reads `ECHO_SERVER_URL`, falls back to `DEFAULT_SERVER_URL`
- [x] 4.4 Implement `_request_human_approval(command, session_id) -> bool` that calls `ask_permission`, returns `True` only on `HitlOutcome.GRANTED`, emits deny + returns `False` on all other outcomes (DENIED → "human denied", TIMEOUT → "timeout", ERROR → "HITL request failed", missing helper → "echo_hitl not available")

## 5. Main flow

- [x] 5.1 Implement `main()` that:
  - Reads input via `_read_input()`
  - Returns silently (allow) if `tool_name != "Bash"`
  - Extracts `command` from `tool_input.command`
  - Classifies via `_classify(command)`
  - Blacklist → `_emit_deny("safety-gate: blacklisted command")` and return
  - Graylist → call `_request_human_approval(command, session_id)`; if False, return (deny already emitted); if True, return silently (allow)
  - Safe → return silently (allow)
- [x] 5.2 Wrap `main()` in `try/except Exception as e: _emit_deny(f"safety-gate: hook error - {e}")` to fail closed on any unexpected error
- [x] 5.3 Add `if __name__ == "__main__":` block calling `main()` then `sys.exit(0)` always

## 6. Settings registration

- [x] 6.1 Read current `agents-observe/.claude/settings.json` to capture exact structure of existing PreToolUse entry
- [x] 6.2 Add a new entry to `hooks.PreToolUse` array (do NOT modify existing send_event.py entry):
  ```json
  {
    "matcher": "Bash",
    "hooks": [{
      "type": "command",
      "command": "uv run --script $CLAUDE_PROJECT_DIR/.claude/hooks/safety_gate.py"
    }]
  }
  ```
- [x] 6.3 Validate JSON parses cleanly (`python3 -m json.tool < settings.json`)

## 7. Manual verification

- [x] 7.1 With echo server running, manually invoke hook by piping a Bash PreToolUse JSON for `rm -rf /` → expect deny JSON in stdout, no HTTP request
- [x] 7.2 Pipe `ls -la` → expect empty stdout, exit 0, < 50ms
- [ ] 7.3 Pipe `rm -rf /tmp/test-foo` → expect HITL POST to server; from another terminal, `curl -X POST .../events/<id>/respond` with `granted: true` → hook exits 0 with empty stdout
- [ ] 7.4 Repeat 7.3 with `granted: false` → expect deny JSON
- [x] 7.5 With echo server stopped, pipe `rm -rf /tmp/test-bar` → expect deny JSON within `~5s`, reason mentions error
- [x] 7.6 Set `ECHO_HITL_TIMEOUT=2`, pipe graylist command, do not respond → expect deny within ~2s, reason `"safety-gate: timeout"`
- [ ] 7.7 With env-var hack to remove `apps/hitl-helper-python` from sys.path, pipe graylist command → expect deny `"echo_hitl not available"`; pipe `ls` → expect allow

## 8. Live integration test

- [ ] 8.1 Start a Claude Code session in agents-observe, ask agent to run `ls /tmp` → expect immediate execution
- [ ] 8.2 Ask agent to run a graylist command (e.g. `rm -rf /tmp/this-is-a-test-dir`); from dashboard/curl approve → command runs
- [ ] 8.3 Repeat and deny → command blocked, agent sees the deny reason
- [ ] 8.4 Ask agent to run `rm -rf /` → blocked instantly with no HITL prompt
- [ ] 8.5 Confirm `send_event.py` still receives and logs all PreToolUse events (check echo server logs)

## 9. Spec verification

- [x] 9.1 Run `openspec validate safety-gate-hook --strict` → expect zero errors
- [ ] 9.2 Run `openspec verify safety-gate-hook` if/when scaffolded; otherwise spot-check each scenario in spec.md against implementation
- [x] 9.3 Confirm no modifications to `apps/hitl-helper-python/` source
- [x] 9.4 Confirm no modifications to `apps/server/`
- [x] 9.5 Confirm reference project `claude-code-hooks-multi-agent-observability/` is untouched (`git status` in that directory)
