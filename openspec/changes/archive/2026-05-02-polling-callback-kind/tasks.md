## 1. Envelope contract

- [x] 1.1 Update `packages/envelope/types.ts` — add `| { kind: "polling" }` to the `HitlCallback` discriminated union.
- [x] 1.2 Update `packages/envelope/schema.json` — add `"polling"` to `human_in_the_loop.callback.kind` enum; ensure schema permits the polling variant having only the `kind` field.
- [x] 1.3 If a client-side type or fixture references `HitlCallback` exhaustively, update it (`apps/client/src/...`).

## 2. Validator

- [x] 2.1 Update `apps/server/src/envelope/validate.ts::validateCallback` — accept `kind === "polling"` with no further field requirements.
- [x] 2.2 Add a unit test asserting `{ kind: "polling" }` validates successfully.
- [x] 2.3 Add a unit test asserting `{ kind: "polling", url: "anything" }` validates successfully (extra fields preserved verbatim).
- [x] 2.4 Add a regression test asserting `{ kind: "carrier-pigeon" }` still fails with the existing "kind must be websocket/webhook/polling" error.

## 3. Waiter registry

- [x] 3.1 Create `apps/server/src/hitl/waiters.ts` exporting:
  - `register(eventId: number, resolve: (response: object) => void): () => void` — returns cleanup fn.
  - `wake(eventId: number, response: object): void` — resolves all registered waiters for the id and clears the entry.
  - `count(eventId?: number): number` — diagnostic helper, returns set size for one id or total.
- [x] 3.2 Internal storage is a `Map<number, Set<{ resolve: ... }>>`. Cleanup fn removes its own entry; if the set is empty, deletes the map key.
- [x] 3.3 Unit test `apps/server/test/waiters.test.ts`:
  - register + wake → resolver called with response.
  - register + cleanup → wake doesn't call the resolver.
  - register two for same id + wake → both called.
  - 10k register-then-cancel cycle → final `count()` is 0 (no leak).

## 4. HTTP route — long-poll

- [x] 4.1 In `apps/server/src/http/routes/hitl.ts`, register `GET /events/:id/response`.
- [x] 4.2 Parse `wait` querystring as integer, default 30, clamp to `[0, 60]`.
- [x] 4.3 Look up the event via repository:
  - 404 if event missing.
  - 400 if event has no `human_in_the_loop` block.
  - 200 immediately with `human_in_the_loop_status.response` if status is `responded`.
- [x] 4.4 If `wait <= 0` and status is still pending, return 408 immediately.
- [x] 4.5 Otherwise: register a waiter, set up a `setTimeout` for `wait * 1000` ms, await whichever fires first.
  - On wake → 200 with the response body.
  - On timeout → 408.
  - On client disconnect (Bun’s `Request.signal`) → call cleanup and abort.
- [x] 4.6 Set `Cache-Control: no-store` on every response (success and timeout) to defend against intermediaries.

## 5. HTTP route — wake on respond

- [x] 5.1 In `apps/server/src/http/routes/hitl.ts::POST /events/:id/respond`, after persisting the response and before returning 200, call `waiters.wake(id, responsePayload)`.
- [x] 5.2 Order: persist → wake → broadcast → respond. (Persist first so a re-poll triggered by the wake sees the same response.)

## 6. Delivery dispatcher

- [x] 6.1 Update `apps/server/src/hitl/deliver.ts::deliverHitl` — when `callback.kind === "polling"`, return success immediately with no network call.
- [x] 6.2 Add a unit test asserting polling delivery returns success without making any network requests (mock the HTTP / WS clients and assert they were not invoked).

## 7. Integration tests

- [x] 7.1 `apps/server/test/hitl-polling.test.ts::test_response_already_recorded_returns_immediately` — POST event with polling callback, POST response, GET response → 200 with body.
- [x] 7.2 `test_long_poll_resolves_when_response_arrives` — start GET (no await), 100ms later POST response, assert GET resolves within 200ms.
- [x] 7.3 `test_long_poll_408_on_timeout` — GET with `wait=1`, no response, assert 408 within ~1.1s.
- [x] 7.4 `test_wait_clamped_to_60` — GET with `wait=600`, no response, assert 408 within ~61s. (May skip in fast suite or use a smaller clamp under test config — note the trade-off.)
- [x] 7.5 `test_idempotent_re_poll` — get response once, get again, assert same body both times.
- [x] 7.6 `test_concurrent_pollers_both_woken` — two parallel GETs on same event, POST response once, assert both resolve.
- [x] 7.7 `test_event_not_found_returns_404` and `test_event_without_hitl_returns_400`.

## 8. Documentation

- [x] 8.1 Update echo’s top-level `README.md` — under "API", add `GET /events/:id/response?wait=<sec>` with a one-line description.
- [x] 8.2 Add a "Polling callback" subsection under HITL in the README documenting the use case (cloud-hosted echo, agents behind NAT) and a curl example.
- [x] 8.3 Update `apps/server/CLAUDE.md` (or the server-level docs) noting the new waiter module pattern and that it mirrors the broadcaster’s swap-friendly interface.

## 9. Verification

- [x] 9.1 `bun test` from repo root — all tests pass including new polling suite.
- [x] 9.2 Manual smoke: post envelope with `callback: { kind: "polling" }`, in another terminal `curl -m 65 'http://localhost:4000/events/<id>/response?wait=30'`, in a third terminal `curl -X POST -d '{"permission":true}' '.../respond'`. Verify long-poll returns the body within ~50ms.
- [x] 9.3 `openspec validate polling-callback-kind --strict` — no errors.
