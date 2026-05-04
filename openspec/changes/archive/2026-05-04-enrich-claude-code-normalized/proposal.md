## Why

Downstream consumers (sonar UI, dashboards) currently see envelopes from the Claude Code adapter that contain rich data inside `payload` but expose only `tool_name`, `cwd`, and `model_name` in `normalized`. Visualizations therefore fall back to generic verbs like “Reading…” or “Notification” instead of showing the actual file path, prompt text, or notification message that the user already sees in their CLI. The adapter is dropping nothing — it just forwards the verbatim payload — but consumers must reach into Claude-Code-specific keys (`tool_input`, `prompt`, `message`, `tool_response`, `error`) to get usable text, defeating the purpose of `normalized`.

## What Changes

- Extend the Claude Code adapter's `extract_normalized` to populate four additional fields when the source hook payload contains them:
  - `normalized.user_prompt` ← `payload.prompt` (UserPromptSubmit)
  - `normalized.tool_input` ← `payload.tool_input` (PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest) — copied as-is
  - `normalized.tool_output` ← `payload.tool_response` (PostToolUse)
  - `normalized.error` ← `{ message: payload.error }` (PostToolUseFailure)
- Extend the `EventEnvelope.NormalizedFields` shape with one additive optional field `notification_message?: string` so `Notification` hook payloads can surface their human-facing text via the canonical `normalized` block. Adapter populates it from `payload.message`.
- All extractions remain best-effort: missing source keys mean the corresponding normalized field is omitted (no empty objects, no exceptions, no LLM calls).
- The adapter's existing rule "SHALL NOT add a `summary` field" is preserved. This change only widens `normalized`.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `claude-code-adapter`: the "Envelope assembly from hook payload" requirement gains additional optional normalized extractions (user_prompt, tool_input, tool_output, error, notification_message).
- `event-envelope`: `NormalizedFields` gains an optional `notification_message` field. Purely additive; existing envelopes remain valid.

## Impact

- **Code**: `apps/adapter-claude-code/send_event.py` (`extract_normalized`); `packages/envelope/types.ts` and `packages/envelope/envelope.schema.json` (add `notification_message`).
- **Tests**: `apps/adapter-claude-code/tests/test_envelope.py` for the new extractions; envelope fixture/schema validation tests.
- **Consumers**: sonar UI immediately gains useful content for tool.pre_use / user.prompt.submit / agent.notification bubbles via existing priority chain (no sonar code change required to benefit). hitl-helper and dashboards may opt-in to read the new fields.
- **Backward compatibility**: fully additive. Old consumers ignore new fields; old envelopes (without these fields) remain valid.
- **Performance**: no new I/O. Extractions are dict lookups on data already in memory. No LLM calls.
- **Out of scope**: generating a `summary` field; renaming or removing existing fields; non-Claude-Code adapters.
