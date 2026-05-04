## ADDED Requirements

### Requirement: Recognized normalized convenience fields

The envelope's optional `normalized` block MAY contain any of the following recognized convenience fields. Each field is independently optional; consumers MUST treat any absent field as "not provided" (not as a typed empty value). Producers SHALL omit a field entirely rather than emit an empty string, empty object, or `null`.

| Field | Type | Meaning |
|---|---|---|
| `tool_name` | string | Name of the tool the agent intends to use or has used |
| `tool_input` | object | The tool's input arguments, vendor-defined shape, copied verbatim from the agent payload |
| `tool_output` | any JSON | The tool's output / response, vendor-defined shape, copied verbatim |
| `user_prompt` | string | A prompt typed by the human user toward the agent |
| `notification_message` | string | A heads-up message emitted by the agent toward the human (e.g. attention requests, idle warnings); used when the agent is *not* blocking on a response (for blocking, use `human_in_the_loop` instead) |
| `model_name` | string | Identifier of the underlying LLM (e.g. `claude-sonnet-4-5`) |
| `cwd` | string | Working directory at the time of the event |
| `error` | `{ message: string; code?: string }` | Error details when the event represents a failure |

The list is open-ended: producers MAY include additional vendor-specific keys under `normalized`, but consumers SHOULD prefer the fields above for cross-vendor compatibility. The envelope schema SHALL allow `notification_message` as an optional string property of `NormalizedFields` and SHALL continue to allow unknown additional properties under `normalized`.

#### Scenario: notification_message present

- **WHEN** an envelope has `event_type: "agent.notification"` and `normalized.notification_message: "Token limit warning"`
- **THEN** schema validation succeeds and downstream consumers can read the string directly without inspecting `payload`

#### Scenario: notification_message absent

- **WHEN** an envelope has `event_type: "agent.notification"` but no `normalized.notification_message`
- **THEN** schema validation succeeds (the field is optional) and consumers MUST treat the message as unavailable rather than as an empty string

#### Scenario: Recognized fields are independent

- **WHEN** an envelope provides only `normalized.user_prompt` and no other normalized fields
- **THEN** schema validation succeeds; absent fields (`tool_input`, `tool_output`, `notification_message`, etc.) MUST NOT be inferred as empty

#### Scenario: notification_message is distinct from human_in_the_loop

- **WHEN** an event is purely informational and does not block the agent
- **THEN** producers SHALL use `normalized.notification_message` (with `event_type: "agent.notification"`) rather than `human_in_the_loop`, preserving the existing rule that HITL is reserved for blocking interactions
