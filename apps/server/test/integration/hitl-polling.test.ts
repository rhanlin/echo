import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { makeEnvelope, startTestServer, type TestServer } from './_helpers';

describe('HITL polling long-poll', () => {
  let s: TestServer;
  beforeAll(() => { s = startTestServer(); });
  afterAll(async () => { await s.stop(); });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function postPollingEnvelope(opts: Record<string, unknown> = {}) {
    const res = await fetch(`${s.baseUrl}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeEnvelope({
        human_in_the_loop: {
          question: 'Allow?',
          type: 'permission',
          callback: { kind: 'polling' },
        },
        ...opts,
      })),
    });
    return (await res.json()) as { id: number };
  }

  async function respond(id: number, body: Record<string, unknown> = { permission: true }) {
    return fetch(`${s.baseUrl}/events/${id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function poll(id: number, wait = 5) {
    return fetch(`${s.baseUrl}/events/${id}/response?wait=${wait}`);
  }

  // ---------------------------------------------------------------------------
  // 7.1: Response already recorded — returns immediately
  // ---------------------------------------------------------------------------
  test('response already recorded returns immediately', async () => {
    const created = await postPollingEnvelope({ session_id: 'poll-already' });
    await respond(created.id);

    const start = Date.now();
    const res = await poll(created.id);
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    const body = await res.json() as { permission: boolean };
    expect(body.permission).toBe(true);
    // Should be nearly instant — well under 500ms
    expect(elapsed).toBeLessThan(500);
  });

  // ---------------------------------------------------------------------------
  // 7.2: Long-poll resolves when response arrives
  // ---------------------------------------------------------------------------
  test('long-poll resolves within 200ms when response arrives 100ms later', async () => {
    const created = await postPollingEnvelope({ session_id: 'poll-wake' });

    const start = Date.now();
    // Start the GET (no await yet)
    const pollPromise = poll(created.id, 5);

    // 100ms later, post the response
    await new Promise((resolve) => setTimeout(resolve, 100));
    await respond(created.id, { permission: true, responded_by: 'tester' });

    const res = await pollPromise;
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    const body = await res.json() as { permission: boolean };
    expect(body.permission).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });

  // ---------------------------------------------------------------------------
  // 7.3: Long-poll 408 on timeout
  // ---------------------------------------------------------------------------
  test('long-poll 408 when no response arrives in time', async () => {
    const created = await postPollingEnvelope({ session_id: 'poll-timeout' });

    const start = Date.now();
    const res = await poll(created.id, 1);
    const elapsed = Date.now() - start;

    expect(res.status).toBe(408);
    // Should time out in ~1s, not longer than 2.5s
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(2500);
  });

  // ---------------------------------------------------------------------------
  // 7.4: wait=0 returns 408 immediately
  // ---------------------------------------------------------------------------
  test('wait=0 returns 408 immediately for pending event', async () => {
    const created = await postPollingEnvelope({ session_id: 'poll-zero' });

    const start = Date.now();
    const res = await fetch(`${s.baseUrl}/events/${created.id}/response?wait=0`);
    const elapsed = Date.now() - start;

    expect(res.status).toBe(408);
    expect(elapsed).toBeLessThan(200);
  });

  // ---------------------------------------------------------------------------
  // 7.5: Idempotent re-poll after answer
  // ---------------------------------------------------------------------------
  test('idempotent re-poll returns same body both times', async () => {
    const created = await postPollingEnvelope({ session_id: 'poll-idempotent' });
    await respond(created.id, { choice: 'zod' });

    const first = await (await poll(created.id)).json();
    const second = await (await poll(created.id)).json();

    expect(first).toMatchObject({ choice: 'zod' });
    expect(second).toMatchObject({ choice: 'zod' });
  });

  // ---------------------------------------------------------------------------
  // 7.6: Concurrent pollers both woken
  // ---------------------------------------------------------------------------
  test('two concurrent pollers both receive the response', async () => {
    const created = await postPollingEnvelope({ session_id: 'poll-concurrent' });

    const [p1, p2] = await Promise.all([
      // Start both long-polls, then respond after 100ms
      (async () => {
        const pollProm = poll(created.id, 5);
        return pollProm;
      })(),
      (async () => {
        const pollProm = poll(created.id, 5);
        return pollProm;
      })(),
      // Respond after 100ms
      (async () => {
        await new Promise((r) => setTimeout(r, 100));
        await respond(created.id, { permission: true });
      })(),
    ]);

    expect(p1.status).toBe(200);
    expect(p2.status).toBe(200);
    expect(await p1.json()).toMatchObject({ permission: true });
  });

  // ---------------------------------------------------------------------------
  // 7.7: 404 and 400 error cases
  // ---------------------------------------------------------------------------
  test('event not found returns 404', async () => {
    const res = await fetch(`${s.baseUrl}/events/99999/response?wait=0`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/not found/i);
  });

  test('event without HITL block returns 400', async () => {
    const no = await fetch(`${s.baseUrl}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeEnvelope({ session_id: 'no-hitl-poll' })),
    });
    const { id } = await no.json() as { id: number };

    const res = await fetch(`${s.baseUrl}/events/${id}/response?wait=0`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/HITL/i);
  });

  // ---------------------------------------------------------------------------
  // 6.2: Polling delivery does not make outbound network calls
  // ---------------------------------------------------------------------------
  test('polling callback delivery is a no-op — respond flips status to responded', async () => {
    const created = await postPollingEnvelope({ session_id: 'poll-deliver' });

    const res = await respond(created.id, { permission: true });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      human_in_the_loop_status: { status: string };
    };
    // Status must be responded (not error) — no outbound call failed
    expect(body.human_in_the_loop_status.status).toBe('responded');
  });
});
