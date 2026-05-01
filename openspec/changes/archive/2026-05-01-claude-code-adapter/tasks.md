## 1. Verify env-injection assumption

- [x] 1.1 Write a one-shot probe hook (`apps/adapter-claude-code/_probe_env.py`) that prints `os.environ` to stderr.
- [x] 1.2 Add it to `agents-observe`'s `.claude/settings.json` as a `SessionStart` hook with a top-level `env` block setting `ECHO_PROBE_TOKEN=hello`.
- [x] 1.3 Trigger a session, inspect Claude Code's stderr / log output, and confirm whether `ECHO_PROBE_TOKEN` appears.
- [x] 1.4 Record the result in `apps/adapter-claude-code/README.md` ("Configuration" section) — env-block confirmed working OR fallback to CLI-flag-only.
- [x] 1.5 Remove the probe hook entry from `settings.json` and delete `_probe_env.py`.

## 2. Project scaffold

- [x] 2.1 Create `apps/adapter-claude-code/` directory.
- [x] 2.2 Create `pyproject.toml` declaring Python ≥ 3.10 and adapter version (start at `0.1.0`).
- [x] 2.3 Create `send_event.py` with a `# /// script` uv-script header (no external deps beyond stdlib for v1; uses `urllib`).
- [x] 2.4 Create `mappings.py` exporting `HOOK_TO_EVENT_TYPE: dict[str, str]` populated per the design table.
- [x] 2.5 Create `tests/` with an empty `__init__.py` and a `conftest.py` that sets up fixture loading from `tests/fixtures/`.

## 3. Mapping table

- [x] 3.1 Define `HOOK_TO_EVENT_TYPE` covering all 12 hook event names.
- [x] 3.2 Add `tests/test_mappings.py::test_all_hooks_map_to_canonical` — for each value in the table, assert it's in `CANONICAL_EVENT_TYPES` (load the canonical list from `packages/envelope/event-types.ts` via a parser, or copy as a Python constant if simpler).
- [x] 3.3 Add `tests/test_mappings.py::test_permission_request_folds_into_pre_use` — explicitly assert PermissionRequest and PreToolUse both map to `tool.pre_use`.

## 4. Configuration resolution

- [x] 4.1 Implement `resolve_config(args, env)` in `send_event.py` that returns `(server_url, source_app)` per the priority order in the spec.
- [x] 4.2 Add `tests/test_config.py::test_cli_flag_overrides_env` — both set, CLI wins.
- [x] 4.3 Add `tests/test_config.py::test_env_used_when_no_flag` — only env set, env value used.
- [x] 4.4 Add `tests/test_config.py::test_default_server_url` — neither set for `--server-url`, default used.
- [x] 4.5 Add `tests/test_config.py::test_missing_source_app_warns_and_exits_zero` — neither set for `--source-app`, captures stderr warning, asserts exit 0.

## 5. Envelope assembly

- [x] 5.1 Implement `build_envelope(stdin_payload, event_type_arg, source_app, agent_version)` returning a Python dict matching the v1 envelope shape.
- [x] 5.2 Implement `extract_normalized(payload)` returning `tool_name`, `cwd`, and (best-effort) `model_name`. Omit the field entirely when empty.
- [x] 5.3 Implement `extract_model_name(transcript_path)` reading the last assistant message from a `.jsonl` transcript with a hard 100ms wall-clock budget (skip on timeout or any IO error).
- [x] 5.4 Add `tests/fixtures/` containing one representative stdin JSON payload per hook event name (12 files).
- [x] 5.5 Add `tests/test_envelope.py::test_envelope_shape_per_hook` — for each fixture, build envelope and assert all required v1 fields are present and well-typed.
- [x] 5.6 Add `tests/test_envelope.py::test_payload_preserved_verbatim` — assert `envelope["payload"]` equals the input dict object-by-object.
- [x] 5.7 Add `tests/test_envelope.py::test_normalized_omitted_when_empty` — fixture with no extractable fields produces no `normalized` key.
- [x] 5.8 Add `tests/test_envelope.py::test_normalized_populated_when_available` — fixture with `tool_name` and `cwd` produces matching `normalized` block.
- [x] 5.9 Add `tests/test_envelope.py::test_missing_session_id_exits_zero` — fixture without `session_id` triggers warn-and-exit-zero path.

## 6. HTTP delivery

- [x] 6.1 Implement `post_envelope(server_url, envelope_dict)` using `urllib.request` with a 5-second timeout.
- [x] 6.2 Wrap the call so any exception (URLError, HTTPError, timeout, generic) is caught, logged to stderr as a single structured line, and the function returns False.
- [x] 6.3 Add `tests/test_http.py::test_success_path_silent` — using `unittest.mock` to stub the HTTP layer, assert no stderr on 200.
- [x] 6.4 Add `tests/test_http.py::test_connection_refused_warns_zero` — stub raises ConnectionRefusedError, assert stderr warning and process exit 0.
- [x] 6.5 Add `tests/test_http.py::test_500_response_warns_zero` — stub returns HTTP 500, assert stderr warning naming the status and exit 0.
- [x] 6.6 Add `tests/test_http.py::test_timeout_within_six_seconds` — stub hangs, assert adapter completes within 6 seconds total.

## 7. CLI wiring

- [x] 7.1 Implement `main()` in `send_event.py` that parses args, reads stdin, resolves config, builds envelope, posts, and exits 0 (always).
- [x] 7.2 Wrap the entire `main()` body in a top-level `try/except Exception` that catches anything missed and exits 0 with a stderr warning.
- [x] 7.3 Add `tests/test_cli.py::test_unknown_event_type_warns_zero` — invoke main with `--event-type Bogus`, assert exit 0 and stderr warning.
- [x] 7.4 Add `tests/test_cli.py::test_malformed_stdin_warns_zero` — invoke main with non-JSON on stdin, assert exit 0 and stderr warning.

## 8. Dogfooding

- [x] 8.1 Add hook entries to `agents-observe`'s `.claude/settings.json` for all 12 hook event names, each invoking `uv run apps/adapter-claude-code/send_event.py --event-type <Name>`.
- [x] 8.2 Add the top-level `env` block (or `--source-app` flags, depending on Task 1 outcome) wiring `source_app` to `agents-observe`.
- [x] 8.3 Start echo server, trigger each hook through normal Claude Code usage in this repo, and verify events appear in `GET /events/recent`.
- [x] 8.4 Spot-check one event of each type in the dashboard for shape correctness (canonical `event_type`, preserved `payload`, populated `normalized` where applicable).

## 9. Documentation

- [x] 9.1 Create `apps/adapter-claude-code/examples/settings.full.json` — complete `.claude/settings.json` covering all 12 hooks plus the `env` block, with `/ABSOLUTE/PATH/TO/echo/...` placeholder paths.
- [x] 9.2 Create `apps/adapter-claude-code/examples/settings.merge.jsonc` — annotated snippet showing (a) the top-level `env` block to add and (b) the append-entry shape for an existing hook array, with at least one fully worked example (e.g. `PreToolUse`).
- [x] 9.3 Write `apps/adapter-claude-code/README.md` covering: what it is, install (clone the repo), two onboarding paths (drop-in vs merge) referencing the example files, configuration table (CLI flags + env vars), event mapping table, troubleshooting (where to find stderr logs).
- [x] 9.4 Add a "Use it with Claude Code" section to echo's top-level `README.md` linking to the adapter README.
- [x] 9.5 Document the env-injection verification result from Task 1 prominently in the adapter README.

## 10. Verification

- [x] 10.1 Run the full Python test suite (`cd apps/adapter-claude-code && uv run pytest`) — all tests pass.
- [x] 10.2 Run echo's existing TS test suite to confirm no regressions (`bun test` from repo root).
- [x] 10.3 Run `openspec validate claude-code-adapter --strict` — no errors.
- [x] 10.4 Manually verify in dashboard: every one of the 12 hooks produces a correctly-shaped envelope visible in `/events/recent`.
