## Why

Currently agents-observe has no PreToolUse safety hook — `rm -rf <something>` runs unchecked unless Claude Code's built-in approval catches it. We want a layered defence: clearly catastrophic commands (`rm -rf /`) blocked locally and instantly, while gray-area destructive commands (`rm -rf ~/Downloads/cache`) get pushed to the dashboard for human approval via the existing `echo_hitl` helper. This makes the dashboard a real control surface (not just a viewer) and lets us safely allow useful-but-dangerous operations without giving the agent unrestricted access.

## What Changes

- Add new hook `agents-observe/.claude/hooks/safety_gate.py` — PreToolUse hook that:
  - Inspects Bash commands
  - **Hard-deny**: matches a configurable `BLACKLIST_PATTERNS` (e.g. `rm -rf /`, `rm -rf ~`, `rm -rf $HOME`) → emit `permissionDecision: deny` immediately
  - **Gray-zone**: matches `GRAYLIST_PATTERNS` (other `rm -rf` not in `ALLOWED_RM_DIRECTORIES`) → call `echo_hitl.ask_permission()`, block until human responds via dashboard
  - **Safe**: nothing matches → exit 0 (allow)
  - On `HitlOutcome.GRANTED` → exit 0; on `DENIED/TIMEOUT/ERROR` → emit deny JSON
- Update `agents-observe/.claude/settings.json` to add `safety_gate.py` as a PreToolUse hook (Bash matcher), running alongside existing `send_event.py`
- Configurable via env vars: `ECHO_HITL_TIMEOUT` (default 60s), `ECHO_HITL_FALLBACK` (always `deny` in v1; reserved for future)
- Self-contained: stdlib only + `echo_hitl` (path-resolved relative to hook file location)

Out of scope (v1):
- Other dangerous patterns (`git push --force`, `DROP TABLE`, `curl ... | sh`) — leave structure for future addition
- `.env` file access detection — orthogonal concern
- Logging to disk (Layer A `send_event.py` already records the event)
- Per-tool gates (Write, Edit) — Bash only in v1

## Capabilities

### New Capabilities
- `safety-gate-hook`: PreToolUse hook that classifies Bash commands as blacklisted (instant deny), graylisted (route to dashboard via HITL), or safe (allow). Covers pattern classification, hard-deny output, HITL invocation, and fallback semantics.

### Modified Capabilities
None — `human-in-the-loop` and `hitl-helper` already provide the polling + Python helper; this change consumes them without altering their contracts.

## Impact

- **New code**: `agents-observe/.claude/hooks/safety_gate.py` (~150 LoC), small unit test file
- **Modified config**: `agents-observe/.claude/settings.json` — adds one PreToolUse hook entry
- **No server changes**: uses existing `POST /events` and `GET /events/:id/response`
- **No envelope changes**: uses existing polling callback
- **Dependency**: hook script imports `echo_hitl` from `apps/hitl-helper-python/echo_hitl.py` via path injection (uses `$CLAUDE_PROJECT_DIR`)
- **Behavioral change**: previously, dangerous `rm -rf` outside allowed dirs ran (no check); after this change, blacklist commands are blocked, graylist commands require dashboard approval
- **Latency impact**: Bash tool calls that hit the graylist will block for up to `ECHO_HITL_TIMEOUT` seconds (default 60s); safe commands incur ~0ms overhead
