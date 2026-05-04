# Adapter Guide

How to ship an adapter for a new AI coding agent (or extend an existing one) so its events flow into echo.

## What an adapter does

An adapter is a thin process that:

1. Subscribes to events from the agent's native lifecycle/hook system.
2. Translates each event into the **envelope v1** shape.
3. POSTs it to the echo server (`POST /events`).
4. (Optional) Implements the human-in-the-loop callback (websocket or webhook) so server-relayed responses are surfaced back to the user.

The wire format is a single JSON object. Adapters are language-agnostic — anything that can speak HTTP works.

## The envelope contract

Canonical reference: [`packages/envelope/envelope.schema.json`](../packages/envelope/envelope.schema.json) (JSON Schema draft 2020-12).
TypeScript mirror: [`packages/envelope/types.ts`](../packages/envelope/types.ts).

### Required fields (top-level, snake_case)

| Field              | Type             | Notes                                                             |
| ------------------ | ---------------- | ----------------------------------------------------------------- |
| `envelope_version` | `1`              | Integer literal. Bumped only on breaking changes.                 |
| `agent_kind`       | string           | e.g. `claude-code`, `gemini-cli`, `codex`, `cursor`.              |
| `agent_version`    | string           | Adapter-reported semver.                                          |
| `source_app`       | string           | User-defined project/app id.                                      |
| `session_id`       | string           | Agent-generated session identifier.                               |
| `event_type`       | string           | Normalized event name; SHOULD be from canonical list (see below). |
| `raw_event_type`   | string           | Original native event name.                                       |
| `payload`          | object           | The agent's native payload, untouched.                            |

### Optional fields

- `timestamp` (ms since epoch). Server fills receive time if missing.
- `normalized` — adapter-extracted convenience fields (`tool_name`, `tool_input`, `user_prompt`, `model_name`, `cwd`, `error`, etc.).
- `summary` — short, human-readable adapter-generated summary.
- `transcript` — inline conversation messages (terminal events only).
- `transcript_ref` — pointer to a transcript: `{ kind: "file" | "url", location: string }`.
- `human_in_the_loop` — see HITL section below.

## Canonical event types

Source: [`packages/envelope/event-types.ts`](../packages/envelope/event-types.ts).

| Canonical                | Typical native names (examples)                          |
| ------------------------ | -------------------------------------------------------- |
| `session.start`          | `SessionStart`, `session_begin`                          |
| `session.end`            | `Stop`, `end_of_turn`, `session_end`                     |
| `user.prompt.submit`     | `UserPromptSubmit`, `user_message`                       |
| `tool.pre_use`           | `PreToolUse`, `tool_call_intercept`, `before_tool`       |
| `tool.post_use`          | `PostToolUse`, `tool_call_result`, `after_tool`          |
| `tool.failure`           | `tool_error`, `ToolFailure`                              |
| `agent.notification`     | `Notification`, `notification_event`                     |
| `agent.stop`             | `Stop` (when user-initiated)                             |
| `agent.precompact`       | `PreCompact`                                             |
| `subagent.start`         | `subagent_start`, `task_started`                         |
| `subagent.stop`          | `SubagentStop`, `task_completed`                         |
| `unknown`                | anything you can't classify                              |

The server **does not enforce** this vocabulary — non-canonical values are accepted and logged. Use `unknown` rather than guessing.

## Human-in-the-Loop

Set `human_in_the_loop` when the agent needs a human decision before continuing. The server persists the request, broadcasts it to dashboard subscribers, and waits for a `POST /events/:id/respond` call. It then delivers the human's response back via the `callback` you specified.

```json
{
  "human_in_the_loop": {
    "question": "Run rm -rf node_modules?",
    "type": "permission",
    "callback": { "kind": "websocket", "url": "ws://localhost:5555/cb" }
  }
}
```

Callback options:

- `{ kind: "websocket", url }` — server connects, sends one JSON frame, closes. 5s timeout.
- `{ kind: "webhook", url, method? }` — server makes one HTTP request (default POST). Non-2xx is treated as failure. 5s timeout.
- `{ kind: "polling" }` — producer long-polls `GET /events/:id/response` until a human responds or the timeout elapses.

Set `type: "choice"` and supply `choices: string[]` when offering a fixed list. Use `type: "permission"` for boolean approval, `type: "question"` for free-text answers.

## Reference snippet — TypeScript / Node / Bun

```ts
async function postEvent(envelope: object) {
  const res = await fetch('http://localhost:4000/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  if (!res.ok) throw new Error(`echo rejected event: ${res.status}`);
}

await postEvent({
  envelope_version: 1,
  agent_kind: 'my-agent',
  agent_version: '0.1.0',
  source_app: 'my-app',
  session_id: 'sess-001',
  event_type: 'tool.pre_use',
  raw_event_type: 'BeforeToolCall',
  payload: { tool: 'Bash', args: { command: 'ls' } },
  normalized: { tool_name: 'Bash' },
});
```

## Reference snippet — Python

```python
import json
import urllib.request

def post_event(envelope: dict) -> None:
    req = urllib.request.Request(
        'http://localhost:4000/events',
        data=json.dumps(envelope).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req) as resp:
        if resp.status >= 300:
            raise RuntimeError(f'echo rejected event: {resp.status}')

post_event({
    'envelope_version': 1,
    'agent_kind': 'my-agent',
    'agent_version': '0.1.0',
    'source_app': 'my-app',
    'session_id': 'sess-001',
    'event_type': 'session.start',
    'raw_event_type': 'session_begin',
    'payload': {},
})
```

## Validation tips

- Keys are **snake_case**. CamelCase fields will be rejected.
- `payload` is required and must be a JSON object (not a string, array, or null).
- `envelope_version` must be the integer `1`.
- Validate against the JSON Schema during development to catch shape drift early.
