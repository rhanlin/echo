# echo adapter for Claude Code

Translates [Claude Code](https://claude.ai/code) hook events into [echo](../../README.md) v1 `EventEnvelope` objects and POSTs them to an echo server.

Every Claude Code lifecycle event — session start/end, tool calls, user prompts, notifications, sub-agents — appears in the echo dashboard in real time.

**Fire-and-forget**: the adapter always exits 0 and never blocks your Claude Code session. A failed POST is logged to stderr and silently skipped.

---

## Install

Clone the echo repo once:

```bash
git clone https://github.com/your-org/echo.git ~/echo
```

The adapter lives at `apps/adapter-claude-code/send_event.py`. It is a self-contained [`uv` script](https://docs.astral.sh/uv/guides/scripts/) with no external dependencies (stdlib only). You need [uv](https://docs.astral.sh/uv/) installed — if you use Claude Code you almost certainly have it already.

---

## Wire it up

### Path A — starting from scratch (no existing `.claude/settings.json`)

Copy the drop-in template and edit the two placeholder values:

```bash
mkdir -p my-project/.claude
cp ~/echo/apps/adapter-claude-code/examples/settings.full.json \
   my-project/.claude/settings.json
```

Then open `my-project/.claude/settings.json` and replace:
- `REPLACE_ME` → your project's short identifier (e.g. `my-backend`)
- `/ABSOLUTE/PATH/TO/echo` → the real path where you cloned echo (e.g. `/Users/you/echo`)

### Path B — merging into an existing `.claude/settings.json`

Open `examples/settings.merge.jsonc` in this directory. It contains annotated instructions and a worked example showing exactly which JSON to add. Two changes needed:

1. Add the `env` block at the top level (sets `ECHO_SOURCE_APP` and `ECHO_SERVER_URL`).
2. For each of the 12 hook types, append one command entry into the hook's array.

---

## Configuration

> **Note on env-injection**: Claude Code's top-level `env` block in `settings.json` is injected into hook subprocess environments. Verified working against the `agents-observe` repo.

| Priority | source_app | server_url |
|---|---|---|
| 1 (highest) | `--source-app` CLI flag | `--server-url` CLI flag |
| 2 | `ECHO_SOURCE_APP` env var | `ECHO_SERVER_URL` env var |
| 3 | *(no default — adapter exits with warning)* | `http://localhost:4000` |

If `source_app` cannot be resolved the adapter writes a warning to stderr and exits 0 without making any HTTP request.

---

## Event mapping

| Claude Code hook | echo `event_type` | Notes |
|---|---|---|
| `SessionStart` | `session.start` | |
| `SessionEnd` | `session.end` | |
| `UserPromptSubmit` | `user.prompt.submit` | |
| `PreToolUse` | `tool.pre_use` | |
| `PostToolUse` | `tool.post_use` | |
| `PostToolUseFailure` | `tool.failure` | |
| `Notification` | `agent.notification` | |
| `Stop` | `agent.stop` | |
| `PreCompact` | `agent.precompact` | |
| `SubagentStart` | `subagent.start` | |
| `SubagentStop` | `subagent.stop` | |
| `PermissionRequest` | `tool.pre_use` | `raw_event_type` distinguishes from PreToolUse |

The original Claude Code hook name is always preserved in `raw_event_type` so dashboards can filter on it.

---

## Normalized fields

For consumers that prefer not to dig into vendor-specific `payload` keys, the adapter populates a `normalized` block on each envelope. Every field is independently optional — when the source key is absent or has the wrong type, that single field is omitted (the rest of the block is unaffected).

| `normalized.<field>` | Source key in `payload` | Hooks that emit it |
|---|---|---|
| `tool_name` | `tool_name` | PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest |
| `tool_input` | `tool_input` (object, copied as-is) | PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest |
| `tool_output` | `tool_response` (any JSON) | PostToolUse |
| `error` | `error` (wrapped as `{ message: <string> }`) | PostToolUseFailure |
| `user_prompt` | `prompt` | UserPromptSubmit |
| `notification_message` | `message` | Notification |
| `cwd` | `cwd` | most hooks |
| `model_name` | extracted from `transcript_path` (≤100ms read budget) | any hook with a transcript |

The full original payload is still preserved verbatim under `payload` — `normalized` is purely for convenience.

---

## Troubleshooting

**Events not appearing in dashboard**

1. Is the echo server running? `curl http://localhost:4000/health`
2. Is `ECHO_SOURCE_APP` set? Check: `echo $ECHO_SOURCE_APP` in a new terminal (or `--source-app` in the hook command).
3. Check Claude Code's hook stderr. Claude Code writes hook stderr to its own log — look for lines starting with `echo-adapter:`.

**"echo-adapter: source_app not set"**

The adapter couldn't resolve `source_app`. Either:
- The `settings.json` `env` block isn't being injected (see note above) → add `--source-app your-app` directly to each hook command.
- You forgot to set `ECHO_SOURCE_APP` in the `env` block.

**"echo-adapter: POST … failed"**

The echo server isn't reachable. The adapter exits 0 so Claude Code is unaffected. Start the echo server (`bun start` from the echo repo root) and the next hook will succeed.

---

## Running the tests

```bash
cd apps/adapter-claude-code
uv run pytest
```

All 43 tests should pass. Tests cover: mapping table, config resolution, envelope assembly, HTTP delivery, and CLI entry point.
