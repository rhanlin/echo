## Context

The Claude Code adapter (`apps/adapter-claude-code/send_event.py`) constructs v1 envelopes from hook stdin. Its `extract_normalized` currently extracts only `tool_name`, `cwd`, and `model_name` (the last via a 100ms transcript-read budget). Everything else stays in `payload` verbatim.

Sonar — and any other consumer that wants to render human-friendly text — currently must reach into Claude-Code-specific keys (`payload.tool_input.file_path`, `payload.prompt`, `payload.message`, …) which couples consumers to a single agent vendor's hook schema. The whole purpose of `normalized` is to give consumers a vendor-neutral surface, so the right fix is at the adapter, not at every consumer.

Inspection of `tests/fixtures/*.json` confirms the source keys:

| Hook | Source key | Target normalized field |
|---|---|---|
| `UserPromptSubmit` | `payload.prompt` | `user_prompt` |
| `PreToolUse` / `PostToolUse` / `PostToolUseFailure` / `PermissionRequest` | `payload.tool_input` | `tool_input` |
| `PostToolUse` | `payload.tool_response` | `tool_output` |
| `PostToolUseFailure` | `payload.error` (string) | `error.message` |
| `Notification` | `payload.message` | `notification_message` (NEW) |

`NormalizedFields` already has slots for the first four; `notification_message` does not exist yet.

## Goals / Non-Goals

**Goals:**
- Populate `normalized.user_prompt`, `normalized.tool_input`, `normalized.tool_output`, `normalized.error` whenever the source hook payload supplies them.
- Add `notification_message` to `NormalizedFields` so `Notification` events surface their human-facing text in the canonical block.
- Preserve all existing fail-safe and verbatim-payload guarantees.
- Keep the change additive: no envelope version bump, no consumer break.

**Non-Goals:**
- Generating a `summary` field (still forbidden by adapter spec; out of scope).
- Calling any LLM or external service.
- Truncating, redacting, or reshaping `tool_input` / `tool_output` content (copy as-is).
- Extending other adapters (claude-code only this round).
- Introducing new optional sub-shapes (e.g. structured `error` from non-string sources) beyond the existing `{ message, code? }`.

## Decisions

### Decision 1: Add `notification_message` to `NormalizedFields` rather than reuse `user_prompt` or invent `summary`

`Notification.message` is text the agent emits *to* the human (e.g. "Claude needs your attention", a permission warning). It is not a user prompt, and the adapter spec already forbids `summary`. A new dedicated optional field is the clearest semantic match.

**Alternatives considered:**
- *Reuse `user_prompt`*: rejected — semantically wrong (direction is reversed) and would confuse downstream filters that legitimately want "user-typed prompts".
- *Generate a `summary`*: rejected — would require relaxing the adapter's anti-summary rule and opens a slippery slope toward LLM calls.
- *Leave it in `payload` only*: rejected — that is the status quo we're explicitly fixing.

### Decision 2: Copy `tool_input` and `tool_output` verbatim, no per-tool normalization

`tool_input` shape varies by tool (Bash: `{command}`; Read/Edit: `{file_path, …}`; Grep: `{pattern}`). Consumers that want pretty rendering already need tool-specific knowledge. The adapter's job is to surface the data; interpretation lives at the consumer (sonar's `eventToThought.ts`, dashboards, etc.).

**Alternatives considered:**
- *Flatten into a string per tool*: rejected — lossy and pushes vendor-specific logic into the adapter.

### Decision 3: `error` extraction wraps the string in `{ message }`

`NormalizedFields.error` is `{ message: string; code?: string }`. Claude Code's `PostToolUseFailure.error` is a plain string; we wrap it as `{ message: payload.error }`. No `code` is set (Claude Code does not provide one).

### Decision 4: Schema changes ride a single PR; no envelope version bump

Adding an optional field to `NormalizedFields` is backward-compatible per the envelope's existing additive-evolution contract. Old consumers ignore it; old envelopes (without the field) remain valid.

## Risks / Trade-offs

- **[Risk] `tool_input` may contain large blobs (e.g. MultiEdit with long strings) and balloon envelope size.** → Mitigation: the data is already in `payload` verbatim, so total envelope bytes do not grow (we only duplicate a reference in JSON; on the wire it's a second copy). If size becomes a problem, a follow-up change can prune `payload` redundant keys after `normalized` is populated. Not in scope here.
- **[Risk] Consumers may now see two copies of the same value (`payload.tool_input` and `normalized.tool_input`).** → Mitigation: documented as the canonical pattern; consumers should prefer `normalized` when present.
- **[Risk] `payload.error` could be non-string in future Claude Code versions.** → Mitigation: extraction guards on `isinstance(value, str)`; if non-string, the field is omitted (fail-safe).
- **[Trade-off] We add a vendor-neutral name (`notification_message`) for what's currently a Claude-Code concept.** Other adapters with similar "agent → human heads-up" events would map their own field here. Acceptable: the name is generic enough.

## Migration Plan

1. Add `notification_message?: string` to `packages/envelope/types.ts` and `envelope.schema.json`.
2. Update `extract_normalized` in `apps/adapter-claude-code/send_event.py` with the five new extractions.
3. Add unit tests covering each fixture.
4. Ship. No data migration; no consumer-side change required.

**Rollback:** revert the two source files. Envelopes emitted between deploy and rollback remain valid (extra optional fields are ignored by the schema validator's default-additive policy).

## Open Questions

None.
