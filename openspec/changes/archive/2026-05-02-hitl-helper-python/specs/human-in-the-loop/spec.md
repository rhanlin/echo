## ADDED Requirements

### Requirement: Polling response body contract stability

The server's `GET /events/:id/response` endpoint SHALL return a JSON body that is a stable, documented subset of `HumanInTheLoopResponse`. Specifically, for permission requests the body SHALL contain `{ "permission": true | false, ... }`, for question requests `{ "response": "..." }`, and for choice requests `{ "choice": "..." }`. Client libraries MAY rely on the presence of these fields to parse outcomes without inspecting the original event's `type`.

#### Scenario: Permission response body shape

- **WHEN** a human responds to a permission-type HITL event via `POST /events/:id/respond` with `{ "permission": true, "responded_by": "alice" }`
- **THEN** the polling endpoint `GET /events/:id/response` returns exactly the same JSON object as its 200 body

#### Scenario: Question response body shape

- **WHEN** a human responds with `{ "response": "use main branch" }`
- **THEN** the polling endpoint returns `{ "response": "use main branch", "responded_at": ... }`

#### Scenario: Choice response body shape

- **WHEN** a human responds with `{ "choice": "Vitest" }`
- **THEN** the polling endpoint returns `{ "choice": "Vitest", "responded_at": ... }`
