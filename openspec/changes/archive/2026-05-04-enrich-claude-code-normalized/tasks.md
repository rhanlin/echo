## 1. Envelope schema extension

- [x] 1.1 Add `notification_message?: string` to the `NormalizedFields` interface in `packages/envelope/types.ts`
- [x] 1.2 Add `"notification_message": { "type": "string" }` to the `normalized` properties in `packages/envelope/envelope.schema.json`
- [x] 1.3 Run envelope package's existing schema/type tests; confirm they still pass with the additive change

## 2. Adapter extraction logic

- [x] 2.1 In `apps/adapter-claude-code/send_event.py`, extend `extract_normalized` to also extract `user_prompt` from `payload.prompt` when it is a non-empty string
- [x] 2.2 Extend `extract_normalized` to extract `tool_input` from `payload.tool_input` when it is a dict (copy reference; verbatim guarantee preserved because envelope construction does not mutate)
- [x] 2.3 Extend `extract_normalized` to extract `tool_output` from `payload.tool_response` when present
- [x] 2.4 Extend `extract_normalized` to extract `error` as `{ "message": payload.error }` when `payload.error` is a non-empty string
- [x] 2.5 Extend `extract_normalized` to extract `notification_message` from `payload.message` when it is a non-empty string
- [x] 2.6 Confirm each extraction is independently guarded so a type mismatch on one field does not affect others, and that the function still returns `None` when no field is extractable

## 3. Adapter tests

- [x] 3.1 In `apps/adapter-claude-code/tests/test_envelope.py`, add a test asserting `normalized.user_prompt == "What files are in this repo?"` for the `UserPromptSubmit` fixture
- [x] 3.2 Add a test asserting `normalized.tool_input == {"command": "ls -la"}` for the `PreToolUse` fixture
- [x] 3.3 Add a test asserting `normalized.tool_output == {"output": "total 24\n..."}` (or matching the fixture verbatim) for the `PostToolUse` fixture
- [x] 3.4 Add a test asserting `normalized.error == {"message": "cat: /nonexistent: No such file or directory"}` for the `PostToolUseFailure` fixture, and that no `code` key is present
- [x] 3.5 Add a test asserting `normalized.notification_message == "Claude needs your attention."` for the `Notification` fixture
- [x] 3.6 Add a test asserting that when `payload.tool_input` is a string (type mismatch), `normalized.tool_input` is omitted but other extracted fields are still present
- [x] 3.7 Add a test asserting that the original `stdin_payload` dict is not mutated after `extract_normalized` runs (deep-equal to a snapshot taken before the call)
- [x] 3.8 Add a test asserting that for a payload with none of the extractable keys, `extract_normalized` still returns `None` (regression on the empty-block omission rule)

## 4. Adapter integration / docs

- [x] 4.1 Skim the existing `extract_normalized`-related tests in `tests/test_mappings.py` and `tests/test_http.py` for assertions that may need updating now that `normalized` carries more keys; update only those that explicitly assert "no other keys"
- [x] 4.2 Update `apps/adapter-claude-code/README.md` (the "Normalized fields" section if present, otherwise add one) to list the full set of extracted fields
- [x] 4.3 Run `pytest` for the adapter package; all green

## 5. End-to-end verification

- [x] 5.1 Pipe each fixture through the CLI against a local echo and confirm the broadcast envelope contains the new `normalized` keys (manual smoke test)
- [x] 5.2 Confirm sonar UI bubbles now display rich content (file path / prompt text / notification message) without any sonar-side change
- [x] 5.3 Run `openspec validate enrich-claude-code-normalized --strict` and confirm the change is valid and ready to archive
