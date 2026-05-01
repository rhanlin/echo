## Why

The echo server's envelope contract (v1) has been designed and implemented but never exercised by a real agent. Without at least one working adapter, the contract remains theoretical — we don't know whether the canonical event types, normalized fields, and snake_case wire format actually fit the data shape that real agents emit. Claude Code is the obvious first target: it has a stable hooks system, well-documented event payloads, and a reference implementation we can study (without copying) to surface design gaps.

## What Changes

- Add a Python CLI adapter (`apps/adapter-claude-code/send_event.py`) that reads Claude Code hook stdin JSON, translates it into a v1 `EventEnvelope`, and POSTs it to the echo server.
- Cover all 12 Claude Code hook event types as fire-and-forget event sources (no HITL, no blocking).
- Define the mapping from Claude Code's `HookEventName` strings (e.g. `PreToolUse`) to echo's canonical `event_type` values (e.g. `tool.pre_use`).
- Resolve adapter configuration via `settings.json`'s top-level `env` block (with CLI flag fallback) — pending a verification experiment that Claude Code actually injects those env vars into hook subprocesses.
- Provide two copy-pasteable examples to fit both onboarding paths: a complete drop-in `settings.json` for users with no existing hooks, and a merge-ready snippet (annotated) for users who already have hook entries.
- Wire the adapter into echo's own `agents-observe` repo so every dev session feeds the dashboard during development.

Out of scope (deferred to future changes):
- HITL helper / `ask_permission()` library (Layer B — separate change after this one).
- Cloud-deployment-friendly callbacks (waits on `polling` callback kind exploration).
- LLM-powered `summary` / `normalized` field extraction (v1.1).
- Automated installer script that merges adapter hooks into a user's existing `settings.json` (manual merge via annotated example is enough for v1).

## Capabilities

### New Capabilities
- `claude-code-adapter`: Translates Claude Code hook events into v1 envelopes and ships them to an echo server. Owns the hook-name-to-canonical-event-type mapping table, the configuration resolution rules (env > CLI flag), and the fail-safe behavior (never block the user's coding session, ever).

### Modified Capabilities
<!-- None — envelope contract and ingestion remain unchanged. -->

## Impact

- **New code**: `apps/adapter-claude-code/` (Python CLI, mappings module, README, tests).
- **Echo's own dotfiles**: `.claude/settings.json` in the `agents-observe` repo gains hook entries pointing at the adapter (dogfooding).
- **No envelope changes**: v1 contract stays frozen; this change validates the contract, doesn't modify it.
- **No server changes**: adapter only consumes the public `POST /events` API.
- **External dependency on Claude Code's hook env-injection behavior**: validated as task 1 of implementation; if the assumption fails, fallback to CLI flags is straightforward.
- **Dogfooding feedback loop**: any envelope friction discovered while running the adapter against real sessions surfaces as follow-up changes (likely v1.1 / v1.2 envelope amendments).
