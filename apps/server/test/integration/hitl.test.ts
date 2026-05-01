import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { makeEnvelope, startTestServer, type TestServer } from './_helpers';

/**
 * Helper: spin up a tiny HTTP listener that captures one webhook hit.
 */
function spawnWebhookSink(
  status = 200,
): { url: string; received: () => Promise<unknown>; stop: () => void } {
  let resolveBody!: (b: unknown) => void;
  const got = new Promise<unknown>((resolve) => {
    resolveBody = resolve;
  });
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.json().catch(() => null);
      resolveBody(body);
      return new Response('ok', { status });
    },
  });
  return {
    url: `http://localhost:${server.port}/`,
    received: () => got,
    stop: () => server.stop(true),
  };
}

describe('HITL response flow', () => {
  let s: TestServer;
  beforeAll(() => {
    s = startTestServer();
  });
  afterAll(async () => {
    await s.stop();
  });

  test('successful webhook delivery flips status to responded', async () => {
    const sink = spawnWebhookSink(200);

    const broadcasts: unknown[] = [];
    s.broadcaster.subscribe({
      send: (p) => {
        const m = JSON.parse(p);
        if (m.type === 'event') broadcasts.push(m.data);
      },
    });

    const created = await postEnvelope(s.baseUrl, {
      human_in_the_loop: {
        question: 'allow?',
        type: 'permission',
        callback: { kind: 'webhook', url: sink.url },
      },
    });
    expect(created.human_in_the_loop_status).toEqual({ status: 'pending' });

    const respondRes = await fetch(`${s.baseUrl}/events/${created.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permission: true, responded_by: 'tester' }),
    });
    expect(respondRes.status).toBe(200);
    const body = (await respondRes.json()) as {
      human_in_the_loop_status: { status: string; response: { permission: boolean } };
    };
    expect(body.human_in_the_loop_status.status).toBe('responded');
    expect(body.human_in_the_loop_status.response.permission).toBe(true);

    expect(await sink.received()).toMatchObject({ permission: true });

    // We should see two broadcasts: ingest + status update.
    expect(broadcasts.length).toBeGreaterThanOrEqual(2);

    sink.stop();
  });

  test('failing webhook flips status to error', async () => {
    const sink = spawnWebhookSink(500);

    const created = await postEnvelope(s.baseUrl, {
      session_id: 'fail-session',
      human_in_the_loop: {
        question: 'allow?',
        type: 'permission',
        callback: { kind: 'webhook', url: sink.url },
      },
    });

    const respondRes = await fetch(`${s.baseUrl}/events/${created.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permission: false }),
    });
    expect(respondRes.status).toBe(200);
    const body = (await respondRes.json()) as {
      human_in_the_loop_status: { status: string; error?: string };
    };
    expect(body.human_in_the_loop_status.status).toBe('error');
    expect(body.human_in_the_loop_status.error).toContain('500');

    sink.stop();
  });

  test('404 when responding to unknown event id', async () => {
    const res = await fetch(`${s.baseUrl}/events/99999/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(404);
  });

  test('400 when event has no human_in_the_loop block', async () => {
    const created = await postEnvelope(s.baseUrl, { session_id: 'no-hitl' });
    const res = await fetch(`${s.baseUrl}/events/${created.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
  });

  test('409 when responding twice', async () => {
    const sink = spawnWebhookSink(200);
    const created = await postEnvelope(s.baseUrl, {
      session_id: 'twice',
      human_in_the_loop: {
        question: '?',
        type: 'permission',
        callback: { kind: 'webhook', url: sink.url },
      },
    });
    await fetch(`${s.baseUrl}/events/${created.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permission: true }),
    });
    const second = await fetch(`${s.baseUrl}/events/${created.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permission: false }),
    });
    expect(second.status).toBe(409);
    sink.stop();
  });
});

async function postEnvelope(
  baseUrl: string,
  overrides: Record<string, unknown>,
): Promise<{ id: number; human_in_the_loop_status?: { status: string } }> {
  const res = await fetch(`${baseUrl}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(makeEnvelope(overrides)),
  });
  return (await res.json()) as { id: number };
}
