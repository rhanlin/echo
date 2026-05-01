## Context

Echo's envelope v1 contract is locked but unproven against any real agent. We need an adapter that:

1. Validates the envelope shape on actual hook payloads (not synthetic fixtures).
2. Demonstrates the "agents-agnostic" claim by mapping a vendor-specific hook system onto the canonical vocabulary.
3. Provides immediate dogfooding value — every claude-code session in the `agents-observe` repo becomes a stream of dashboard events.

Claude Code is the natural first target because it has a stable hook protocol (12 named hooks, JSON over stdin), is already used to develop echo itself, and ships with a reference implementation we can study (at `/Users/Spencer_Lin/Documents/spencer/claude-code-hooks-multi-agent-observability/.claude/hooks/`) — but explicitly NOT copy. The reference uses its own ad-hoc envelope (`hook_event_type`, mixed casing, embedded metadata); echo's job is to translate to the canonical contract owned by the server.

Two prior `/opsx:explore` sessions surfaced the key constraints:

- **HITL is out of scope for v1.** The reference's `utils/hitl.py` shows that HITL in claude-code is invoked from agent code (e.g. `ask_permission()`), not from the standard hook chain. Hook processes are short-lived and fire-and-forget; they cannot reasonably host a blocking WebSocket server. HITL helper goes in a separate change.
- **`source_app` configuration is non-trivial.** The reference passes it as a CLI flag, repeated 12 times across `settings.json`. The cleaner path is to use Claude Code's top-level `env` block — but it's unverified that Claude Code injects those vars into hook subprocesses. This must be the first task.

## Goals / Non-Goals

**Goals:**

- A single Python CLI (`apps/adapter-claude-code/send_event.py`) that translates any of the 12 Claude Code hook events to a v1 envelope and POSTs to echo.
- Adapter is **fire-and-forget**: it MUST NEVER block, retry, or surface errors that could disrupt the user's coding session. Network failures and HTTP errors are logged to stderr and the process exits 0.
- Configuration via `settings.json` top-level `env` block (preferred) with CLI flag fallback.
- Comprehensive `HookEventName → CANONICAL_EVENT_TYPE` mapping for all 12 hooks, with one canonical mapping per hook.
- Adapter wired into `agents-observe`'s own `.claude/settings.json` so dev sessions feed echo.
- README with a copy-pasteable `settings.json` snippet for downstream users.
- Unit tests covering each mapping path on representative hook fixtures.

**Non-Goals:**

- HITL helper / `ask_permission()` library (separate change).
- LLM-extracted `summary` and `normalized` fields — v1 sends raw `payload` only, no AI calls in the adapter.
- Cloud-deployment scenarios — adapter assumes echo at `localhost:4000` (configurable, but tested locally).
- Buffering, retry, queueing on echo unavailability — fire-and-forget is the entire failure mode.
- Distribution as a pip package or independent repo. Lives inside `apps/adapter-claude-code/` for this iteration; extraction is a future concern.

## Decisions

### Decision 1: Single Python CLI, not multiple scripts or TypeScript

The adapter is one file (`send_event.py`) invoked from every hook entry in `settings.json`, distinguished by `--event-type` flag.

**Why:** mirrors the reference's `send_event.py` shape, which is the proven ergonomic. One file = one set of envelope-construction logic = one place to fix bugs. Python (`uv run`) is what Claude Code users already have; adding Bun/Node is an unnecessary install step for someone who just wants observability on their existing workflow.

**Alternatives considered:**

- Multiple Python scripts (one per hook): rejected — duplicates 90% of the envelope assembly code. The 12 hooks differ only in mapping table lookup and which optional fields to forward.
- TypeScript / Bun: rejected — forces non-TS users to install a runtime they don't use. Echo's monorepo language consistency is internal; user-facing distribution should target the host runtime (Python via `uv`, the reference's choice).

### Decision 2: Configuration via `settings.json` top-level `env` block, CLI flag fallback

Adapter reads in priority order:

1. CLI flag (`--source-app`, `--server-url`) — highest priority, for power users who want per-hook overrides.
2. Environment variable (`ECHO_SOURCE_APP`, `ECHO_SERVER_URL`) — populated by `settings.json` `env` block.
3. Hardcoded default for `--server-url` only (`http://localhost:4000`); `source_app` has no default and the adapter exits 0 with a stderr warning if missing.

**Why:** the env-block path keeps `settings.json` clean (12 hook commands collapse to just `--event-type X`), declares config in one visible place, and is consistent with how `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is already used. CLI flag fallback handles both the unverified-injection risk and per-hook customization needs.

**Critical assumption:** Claude Code injects values from `settings.json`'s top-level `env` block into hook subprocess environments. **This is unverified** and is task 0 of implementation — see Risk 1 below.

**Alternatives considered:**

- CLI flag only (reference's approach): rejected — `--source-app cc-hook-multi-agent-obvs` repeated 12× is a maintenance smell. Renaming the source app means editing 12 lines.
- `.echo.json` config file: rejected — adds a new file convention to learn for v1; offers no win over env block once env-injection is verified.
- Auto-derive from `cwd` or git remote: rejected — too magic, breaks for forks and monorepo sub-projects.

### Decision 3: Map all 12 hooks, no PermissionRequest special case

The mapping table is exhaustive — all 12 Claude Code hook event names get a canonical `event_type`:

| Claude Code `HookEventName` | echo `event_type` | Notes |
|---|---|---|
| `SessionStart` | `session.start` | |
| `SessionEnd` | `session.end` | Inline transcript when payload includes `transcript_path` |
| `UserPromptSubmit` | `user.prompt.submit` | |
| `PreToolUse` | `tool.pre_use` | |
| `PostToolUse` | `tool.post_use` | |
| `PostToolUseFailure` | `tool.failure` | |
| `Notification` | `agent.notification` | |
| `Stop` | `agent.stop` | |
| `PreCompact` | `agent.precompact` | |
| `SubagentStart` | `subagent.start` | |
| `SubagentStop` | `subagent.stop` | |
| `PermissionRequest` | `tool.pre_use` | Same canonical bucket as PreToolUse; `raw_event_type` preserves the distinction |

`PermissionRequest` and `PreToolUse` both fold into `tool.pre_use` because they're both "agent intends to use a tool, here's the metadata" semantically. The dashboard uses `raw_event_type` to distinguish display affordances if needed. This avoids inventing a non-canonical type just for one hook variant.

**Why:** keeps the canonical vocabulary frozen and lets `raw_event_type` carry adapter-specific nuance — exactly what the envelope spec promised in `Requirement: Normalized event type vocabulary`.

**Alternatives considered:**

- Skip `PermissionRequest` in v1: rejected — leaves visible holes in the hook coverage. The user can disable the hook in `settings.json` if they don't want it.
- Add `tool.permission_request` to canonical vocabulary: rejected — modifies envelope contract, which v1 explicitly avoided.
- Synthesize a `human_in_the_loop` block on `PermissionRequest`: rejected — that's the HITL helper change's job; doing it here mixes concerns and creates half-working HITL UX.

### Decision 4: Forward all hook payload as-is under `payload`; minimal `normalized` block

The adapter copies the entire stdin JSON into `envelope.payload` unchanged. The `normalized` block carries only fields cheaply extracted without LLM calls:

- `model_name`: if `payload.transcript_path` exists and parsing the last assistant turn is fast (<100ms budget), include it. Otherwise omit.
- `tool_name`: if `payload.tool_name` exists.
- `cwd`: from `payload.cwd` if present.

No `summary` field. No LLM calls. This keeps adapter latency under ~100ms per hook (network round-trip dominates).

**Why:** the adapter's job is translation, not enrichment. `normalized` exists as a convenience for dashboard queries; its values must be cheap, deterministic, and not a hidden cost on the user's session. Summary generation is a server-side concern (or a future v1.1 opt-in).

**Alternatives considered:**

- Match reference's `--summarize` flag (LLM-generated summaries): rejected — adds Anthropic API key requirement, latency, and cost to every hook fire. The reference does this; echo doesn't have to.
- Drop the `normalized` block entirely: rejected — model_name is a high-value query dimension and is cheap if cached. The reference's `utils/model_extractor.py` shows it's tractable.

### Decision 5: Distribution via copy-pasteable examples, not an installer

The adapter ships two example files under `apps/adapter-claude-code/examples/`:

1. **`settings.full.json`** — a complete `.claude/settings.json` covering all 12 hooks plus the `env` block. For users starting from zero, a single copy-paste wires up everything.
2. **`settings.merge.jsonc`** — annotated comments showing the two pieces a user must merge into an existing `settings.json`: (a) the top-level `env` block, (b) one append-entry per hook array. Includes a worked example for `PreToolUse`.

The README explains both paths and which to use ("no existing `.claude/` config" vs "I already use Claude Code hooks"). Adapter path in examples is `/ABSOLUTE/PATH/TO/echo/apps/adapter-claude-code/send_event.py` as a placeholder to make the substitution obvious.

**Why:** most adopters already have a `settings.json` (matchers, custom pre-checks, etc.), so a complete-overwrite example alone fails them. Conversely, only providing a merge snippet hurts the zero-state case. Two short files cover both paths with no per-user logic to maintain.

**Alternatives considered:**

- Single `settings.full.json` only: rejected — silently destroys existing user setups when copied verbatim.
- Annotated merge snippet only: rejected — leaves zero-state users assembling JSON from comments.
- `install.py` that merges hooks into a user's `settings.json` automatically: rejected for v1 — non-trivial scope (JSONC parsing, idempotent merge, backup/restore, conflict detection on existing echo hooks). Worthwhile in a future change if user feedback shows manual merge is friction.

### Decision 6: Fire-and-forget with stderr logging on failure

If the POST to echo fails (network error, non-2xx status, timeout >5s), the adapter:

1. Writes a single-line structured warning to stderr (`echo-adapter: POST failed: <reason>`).
2. Exits with status 0.

No retry. No buffer. No queue. No exception that could surface to the user.

**Why:** the strongest constraint on the adapter is *do not break the user's session*. A failed observability event is acceptable; a Claude Code session that hangs on a hook is not. Buffering would require either disk persistence (complexity) or a long-running daemon (architectural shift). v1 trades event reliability for zero operational footprint.

**Alternatives considered:**

- Disk buffer with retry on next hook: rejected — adds disk I/O, file locking concerns, and grows-without-bound risk. Not justified at v1.
- Long-running daemon: rejected — fundamentally changes deployment model and is the kind of complexity v1 should avoid until there's evidence echo downtime is a real pattern.

## Risks / Trade-offs

**Risk 1: Claude Code may not inject `settings.env` into hook subprocesses.**
→ Mitigation: Task 0 of implementation is an experiment — write a minimal hook that prints `os.environ` and check whether `ECHO_SOURCE_APP` set in `settings.env` shows up. If yes, proceed with env-block design. If no, fall back to CLI flag as the only path and update `settings.json` examples accordingly. Either outcome is acceptable; only the user-facing snippet differs.

**Risk 2: Adapter masks echo server bugs by silently failing.**
→ Mitigation: structured stderr logs are visible to anyone tailing Claude Code's logs. During echo dev, the developer should check stderr if events stop appearing in the dashboard. Long-term, a future change can add an opt-in `--strict` mode that exits non-zero on POST failure.

**Risk 3: `model_name` extraction reads the transcript file every hook fire.**
→ Mitigation: cache by `session_id` in a short-lived per-process LRU; the extracted model rarely changes within a session. The reference's `utils/model_extractor.py` already solved this — re-derive the same approach without copying the code verbatim.

**Risk 4: Mapping table drift between adapter and `event-types.ts`.**
→ Mitigation: tests assert that every value the adapter emits as `event_type` is in `CANONICAL_EVENT_TYPES`. If echo ever adds or renames a canonical type, the test fails until the adapter is updated.

**Risk 5: PermissionRequest folded into `tool.pre_use` may confuse dashboard users.**
→ Mitigation: dashboard can filter on `raw_event_type` to surface PermissionRequest specifically. Document this in the adapter README's "Event mapping" section.

**Trade-off: No retry / no buffering means dashboard misses events when echo is down.**
→ Accepted explicitly. Echo is a dev-time observability tool, not an audit log. Loss tolerance > complexity tolerance for v1.

## Migration Plan

This is a new capability, no migration needed. Rollout:

1. Land the adapter and its tests.
2. Add hook entries to `agents-observe`'s own `.claude/settings.json` (dogfooding).
3. Update echo's top-level README with a "Use it with Claude Code" link to the adapter's README.

Rollback: delete `apps/adapter-claude-code/` and remove the hook entries from `agents-observe`'s `.claude/settings.json`. Nothing in echo's server depends on the adapter.

## Open Questions

- **Q1**: Does `settings.json` `env` block actually inject into hook subprocesses? (Resolved by Task 0 experiment.)
- **Q2**: Should `agent_version` be a hardcoded constant matching the adapter's git tag, or read from a `pyproject.toml`? Lean toward hardcoded constant (`"0.1.0"`) for v1 simplicity; revisit if the adapter is extracted to a separate package.
- **Q3**: Where should the model-extraction LRU cache live (in-process vs `/tmp/echo-cache.json`)? Given the hook process is short-lived (each invocation is a new process), an in-process cache is useless. Two options: skip the cache for v1 and parse the transcript on every fire (~10–50ms cost), or use a tiny `/tmp` JSON file. Recommend "skip the cache" for v1; revisit if profiling shows it matters.
