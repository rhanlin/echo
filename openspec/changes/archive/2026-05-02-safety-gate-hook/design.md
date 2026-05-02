## Context

`agents-observe` runs Claude Code with hooks that POST observation events to the local echo server (`send_event.py`). There is no PreToolUse safety gate — destructive Bash commands run unchecked. The reference project (`claude-code-hooks-multi-agent-observability`) demonstrates a `pre_tool_use.py` that hard-denies `rm -rf` outside an allowlist, but provides no escape valve for legitimate-but-risky operations.

The `hitl-helper-python` change (just archived) provides `ask_permission()` — a stdlib-only function that POSTs a HITL envelope and long-polls for a human decision via the dashboard. This unlocks a new pattern: **dashboard-as-approval-surface** for gray-zone commands.

Current state:
- `agents-observe/.claude/settings.json` has PreToolUse → `send_event.py` only (logging adapter)
- `apps/hitl-helper-python/echo_hitl.py` is implemented and tested
- Dashboard frontend not built yet — but server's `POST /events/:id/respond` accepts manual curl, so this hook is functionally testable today

Constraints:
- Hook must work even when echo server is offline (fallback to deny)
- Hook must be stdlib-only (no pip install in `.claude/hooks/`)
- Hook must not log duplicate events (Layer A's `send_event.py` already records PreToolUse)

## Goals / Non-Goals

**Goals:**

- Provide a single PreToolUse hook (`safety_gate.py`) that classifies Bash commands as blacklist (instant deny), graylist (HITL via dashboard), or safe (allow)
- Integrate cleanly with existing `send_event.py` (parallel execution, no interference)
- Make pattern lists declarative and easy to extend
- Fail closed: server unreachable / timeout → deny (never accidentally allow a destructive command)
- Respect Claude Code hook contract: print JSON to stdout, exit 0

**Non-Goals:**

- Replace or modify `send_event.py` — those concerns are orthogonal (observation vs. control)
- Build the dashboard UI — out of scope for this change
- Cover all dangerous tool types (Write, Edit, NotebookEdit) — Bash-only in v1
- Smart command parsing (AST-level) — regex is sufficient for v1
- Per-user / per-session policy — single global pattern list

## Decisions

### Decision 1: Two-tier classification (blacklist + graylist)

```python
BLACKLIST_PATTERNS = [
    r'\brm\s+.*-[a-z]*r[a-z]*f\s+/\s*$',       # rm -rf /
    r'\brm\s+.*-[a-z]*r[a-z]*f\s+/\*',         # rm -rf /*
    r'\brm\s+.*-[a-z]*r[a-z]*f\s+~\s*$',       # rm -rf ~
    r'\brm\s+.*-[a-z]*r[a-z]*f\s+~/\s*$',      # rm -rf ~/
    r'\brm\s+.*-[a-z]*r[a-z]*f\s+\$HOME',      # rm -rf $HOME
    r'\brm\s+.*-[a-z]*r[a-z]*f\s+\.\s*$',      # rm -rf .
    r'\brm\s+.*-[a-z]*r[a-z]*f\s+\*\s*$',      # rm -rf *
]

# Anything else matching "rm -rf <path>" outside ALLOWED_RM_DIRECTORIES
# falls into the graylist → routes to dashboard
```

**Why:** A human in the dashboard could accidentally approve `rm -rf /` (especially under time pressure or fatigue). Blacklist creates an absolute floor — these commands cannot be approved by any means. Everything else gets a chance via HITL.

**Alternatives considered:**
- Single layer (everything goes to dashboard): too risky — dashboard mistakes become catastrophic
- Three layers (block / warn / ask / allow): overcomplicated for v1

### Decision 2: Pattern lists are module-level constants, not config files

```python
# At top of safety_gate.py
BLACKLIST_PATTERNS: list[str] = [...]
GRAYLIST_PATTERNS: list[str] = [...]
ALLOWED_RM_DIRECTORIES: list[str] = ["trees/", "tmp/", ".cache/"]
```

**Why:** Keeps the hook self-contained and inspectable. Editing patterns means editing one file. No JSON parsing, no schema validation, no config loading errors at hook startup time.

**Alternatives considered:**
- YAML/JSON config in `.claude/safety_gate.config.json`: adds parsing logic and a failure mode (corrupt config → hook crashes → tool still runs)
- Env vars only: too clunky for multi-pattern lists

### Decision 3: HITL fallback always denies

```python
outcome = ask_permission(...)
if outcome == HitlOutcome.GRANTED:
    sys.exit(0)
else:  # DENIED, TIMEOUT, ERROR — all treated as deny
    deny_tool(f"safety-gate: {outcome.value}")
```

**Why:** Fail closed. If echo server is down, dashboard isn't open, or human doesn't respond in time → the safe behaviour is to block, never to silently allow. The cost (occasional false negative when network blips) is much lower than the cost of one accidental destructive operation.

**Alternatives considered:**
- `ECHO_HITL_FALLBACK=allow|deny` env var: footgun — easy to set wrong and forget. Not in v1; can add later if real demand arises.

### Decision 4: Default timeout 60s, configurable via env var

```python
TIMEOUT = int(os.environ.get("ECHO_HITL_TIMEOUT", "60"))
outcome = ask_permission(question, timeout=TIMEOUT, ...)
```

**Why:** 60s is enough for a human watching the dashboard to decide on a single command, but short enough that a forgotten/abandoned approval doesn't keep the agent blocked indefinitely. Long enough that minor distraction is forgiven, short enough that abandonment is detected.

**Alternatives considered:**
- 30s: too aggressive — penalises a human who briefly task-switches
- 300s (echo_hitl default): too long — agent feels frozen, and abandoned approvals waste agent time

### Decision 5: Resolve `echo_hitl` via `$CLAUDE_PROJECT_DIR`

```python
import os, sys
project_dir = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
sys.path.insert(0, os.path.join(project_dir, "apps", "hitl-helper-python"))
from echo_hitl import ask_permission, HitlOutcome
```

**Why:** Claude Code sets `$CLAUDE_PROJECT_DIR` to the project root. This makes the hook portable — same script works regardless of where the user's terminal cwd happens to be when Claude starts. Falls back to `cwd` for safety in case env var is missing.

**Alternatives considered:**
- Hardcoded absolute path: breaks portability across users
- pip-installable `echo-hitl` package: out of scope (hitl-helper-python explicitly chose path-injection)
- Copying `echo_hitl.py` into `.claude/hooks/`: code duplication, drift risk

### Decision 6: Coexist with `send_event.py` (parallel, not merged)

The PreToolUse hook list will have two entries: existing `send_event.py` (logs the event) and new `safety_gate.py` (gates Bash). Both run in parallel; Claude Code waits for all to finish.

**Why:** Single responsibility. `send_event.py` is observability (every project should run it). `safety_gate.py` is policy (project-specific patterns). Coupling them would force every observability adopter to take on policy decisions, and force every policy adopter to handle event delivery.

**Side effect:** When `safety_gate.py` blocks for 60s waiting for human, the tool call is blocked for 60s. This is expected — the user explicitly chose to gate it. `send_event.py` finishes in ~50ms regardless.

## Risks / Trade-offs

- **[False positive blacklist match]** → Regex is brittle; an unusual but legitimate `rm -rf` could match a blacklist pattern → user can't proceed via dashboard. **Mitigation:** Blacklist intentionally narrow (only literal `/`, `~`, `$HOME`, `.`, `*` at end of command). Graylist catches everything else.

- **[False negative — dangerous command not matched]** → A clever destructive command (`find / -delete`, `dd if=/dev/zero of=/dev/sda`) won't match `rm -rf` patterns and will run unchecked. **Mitigation:** Document this clearly. v2 can add more patterns. The hook is defence-in-depth, not a complete sandbox.

- **[Echo server unreachable on every Bash call]** → If server is down, every graylist command takes ~5s (POST timeout) before being denied. Annoying but safe. **Mitigation:** Document; user can comment out the hook entry if echo is intentionally offline.

- **[Hook script error → tool runs anyway]** → If `safety_gate.py` crashes (Python syntax error, missing import), Claude Code may proceed with the tool. **Mitigation:** Wrap `main()` in `try/except` that emits deny on any unexpected error. Add a smoke test.

- **[Concurrent hook output interleaving]** → Both `send_event.py` and `safety_gate.py` write to stdout. Claude Code parses stdout; multiple JSON outputs might confuse it. **Mitigation:** `send_event.py` exits 0 with empty stdout (it doesn't emit `permissionDecision`); only `safety_gate.py` emits decision JSON. Verify by inspecting `send_event.py` source — it's silent on stdout for normal flow.

- **[`$CLAUDE_PROJECT_DIR` missing]** → Falls back to `cwd`, which may not contain `apps/hitl-helper-python/`. **Mitigation:** Try-import with informative error → deny on import failure (fail closed).

## Migration Plan

No migration. New hook, no existing behaviour to preserve. Rollback: remove the entry from `settings.json`.

## Open Questions

- Should we add any other patterns beyond `rm -rf` in v1? (Answered: no — keep scope tight)
- Should the hook also gate `Write`/`Edit` for sensitive paths (e.g. `~/.ssh/`)? (Answered: no — Bash only in v1, structure leaves room for extension)
