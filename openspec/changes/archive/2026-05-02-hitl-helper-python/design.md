## Context

Echo's server already implements the full HITL pipeline:
- `POST /events` accepts envelopes with `human_in_the_loop` + `callback: { kind: "polling" }`.
- `GET /events/:id/response?wait=30` long-polls until a human responds or timeout.
- `POST /events/:id/respond` records the human's decision and wakes all pollers.

The existing Python adapter (`apps/adapter-claude-code/send_event.py`) demonstrates stdlib-only HTTP delivery. Layer A is fire-and-forget — it POSTs and exits 0. Layer B (this change) must POST *and block* until a response arrives.

The primary consumer is Claude Code hook code (`pre_tool_use.py`) running in a multi-agent setup. Hooks receive JSON via stdin (including `session_id`), can block the agent indefinitely while awaiting human input, and output a JSON decision (`permissionDecision: allow/deny`) to control tool execution. There is no hard timeout on hook execution — Claude Code waits for the hook process to exit.

## Goals / Non-Goals

**Goals:**

- A single Python module (`echo_hitl.py`) with three public functions: `ask_permission()`, `ask_question()`, `ask_choice()`.
- Stdlib only — no `requests`, no `websockets`, no pip dependencies.
- Returns a typed outcome (not bare `bool`) so callers can distinguish denied vs. timeout vs. error.
- Usable from hook code, standalone scripts, or any Python agent framework.
- Session alignment: uses the same `session_id` / `source_app` that Layer A uses, so HITL events appear alongside observation events in the dashboard.
- CLI mode for manual testing (`python -m echo_hitl --permission "question"`).

**Non-Goals:**

- Async API (asyncio) — hooks are sync, agents can spawn a thread if needed.
- WebSocket or webhook callback — polling only.
- Retry logic on POST failure — fail fast, return `HitlOutcome.ERROR`.
- pip distribution or versioning — in-repo module, importable via path.
- Server-side changes — uses existing endpoints as-is.

## Decisions

### Decision 1: Single module, not a package with submodules

One file: `apps/hitl-helper-python/echo_hitl.py`. No `__init__.py`, no src layout.

**Why:** The consumer (a hook script) does `sys.path.insert(0, "/path/to/apps/hitl-helper-python")` then `from echo_hitl import ask_permission`. Minimal import ceremony. Mirrors Layer A's single-file approach.

**Alternatives considered:**
- Package with `src/echo_hitl/__init__.py`: adds packaging ceremony, editable installs, etc. Overkill for a module consumed via path injection.
- Inline in `adapter-claude-code/`: couples it to Claude Code, breaks the agent-agnostic goal.

### Decision 2: Typed outcome via `HitlOutcome` enum

```python
class HitlOutcome(enum.Enum):
    GRANTED = "granted"       # permission: True
    DENIED = "denied"         # permission: False
    TIMEOUT = "timeout"       # no response within timeout
    ERROR = "error"           # server unreachable / HTTP error / invalid response
```

`ask_permission()` returns `HitlOutcome`, not `bool`.

**Why:** The reference project's `False` conflates denial with timeout — unsafe for multi-agent where "nobody saw it" ≠ "somebody said no". Callers can `match` on all four outcomes with distinct handling (retry on timeout, abort on deny, alert on error).

**Alternatives considered:**
- Return `bool | None` (None = timeout/error): doesn't distinguish error from timeout.
- Raise exceptions for timeout/error: less ergonomic in hook code where you always want a quick `if/else`.

### Decision 3: Envelope assembly is self-contained (no shared code with Layer A)

`echo_hitl.py` builds its own envelope dict inline. It does not import from `send_event.py`.

**Why:** Layer A's envelope assembly is tightly coupled to hook stdin shape (expects `payload` to be the raw hook JSON). Layer B's envelope carries a `human_in_the_loop` block with a `question` + `callback: {kind: "polling"}` — structurally different. Sharing code would require a refactor of Layer A for no real gain. The envelope is ~15 lines of dict construction.

**Alternatives considered:**
- Shared `envelope_builder.py`: adds coupling, and the two layers' envelopes are different enough that sharing is artificial.

### Decision 4: Poll loop with configurable timeout and server-side wait

```python
def _poll_response(event_id, server_url, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        remaining = deadline - time.monotonic()
        wait = min(30, int(remaining))  # server caps at 60, we use 30
        resp = GET f"{server_url}/events/{event_id}/response?wait={wait}"
        if resp.status == 200: return parse(resp)
        if resp.status == 408: continue  # server timeout, retry
        return HitlOutcome.ERROR  # unexpected status
    return HitlOutcome.TIMEOUT
```

**Why:** Matches the server's existing semantics exactly. Default `wait=30` means 1 TCP connection per 30s — negligible overhead. Total timeout is caller-controlled (default 300s = 5 min).

**Alternatives considered:**
- Single long request with `wait=timeout`: server caps at 60s, so this doesn't work for >60s timeouts.
- Short polling (wait=0, sleep between): wastes CPU and adds latency.

### Decision 5: `agent_kind` is a parameter, defaults to `"claude-code"`

```python
ask_permission(
    question="...",
    source_app="my-app",
    session_id="sess-123",
    agent_kind="claude-code",  # default, overridable for other agents
)
```

**Why:** Makes the module agent-agnostic without forcing non-Claude-Code users to discover what value to pass. The default covers the primary use case.

## Risks / Trade-offs

- **[Hook process killed unexpectedly]** → If the user force-quits Claude Code, the hook process dies mid-poll. The server's waiter is cleaned up by disconnect detection. The event stays `pending` in the dashboard. No data corruption. Mitigation: document that orphaned pending events are expected in crash scenarios.

- **[Echo server unreachable]** → `ask_permission()` returns `HitlOutcome.ERROR` immediately after the POST fails (5s timeout). The hook must decide what to do — recommended pattern: deny on error (safe default). Mitigation: document the recommended `ERROR → deny` pattern in the integration example.

- **[Dashboard not open]** → Event sits pending, poll times out, returns `HitlOutcome.TIMEOUT`. Same as "nobody saw it". Mitigation: the timeout is configurable; callers can set a generous timeout (e.g., 10 min) for async workflows.

- **[Stdlib urllib.request is verbose]** → ~20 lines per HTTP call vs. 2 with `requests`. Trade-off accepted for zero-dependency guarantee. Encapsulated in private helpers.
