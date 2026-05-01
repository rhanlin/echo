import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { makeEnvelope, startTestServer, type TestServer } from './_helpers';

describe('GET /events/filter-options', () => {
  let s: TestServer;
  beforeAll(async () => {
    s = startTestServer();
    const seeds = [
      makeEnvelope({ agent_kind: 'claude-code', source_app: 'a', session_id: 's1' }),
      makeEnvelope({ agent_kind: 'cursor', source_app: 'b', session_id: 's2' }),
      makeEnvelope({ agent_kind: 'claude-code', source_app: 'a', session_id: 's1' }),
      makeEnvelope({
        agent_kind: 'gemini-cli',
        source_app: 'c',
        session_id: 's3',
        event_type: 'session.start',
      }),
    ];
    for (const e of seeds) {
      await fetch(`${s.baseUrl}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(e),
      });
    }
  });
  afterAll(async () => {
    await s.stop();
  });

  test('returns distinct values per dimension', async () => {
    const res = await fetch(`${s.baseUrl}/events/filter-options`);
    const body = (await res.json()) as {
      agent_kinds: string[];
      source_apps: string[];
      session_ids: string[];
      event_types: string[];
    };

    expect(body.agent_kinds.sort()).toEqual(['claude-code', 'cursor', 'gemini-cli']);
    expect(body.source_apps.sort()).toEqual(['a', 'b', 'c']);
    expect(body.session_ids.sort()).toEqual(['s1', 's2', 's3']);
    expect(body.event_types.sort()).toEqual(['session.start', 'tool.pre_use']);
  });
});
