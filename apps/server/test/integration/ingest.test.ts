import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { makeEnvelope, startTestServer, type TestServer } from './_helpers';

describe('POST /events ingestion', () => {
  let s: TestServer;
  beforeAll(() => {
    s = startTestServer();
  });
  afterAll(async () => {
    await s.stop();
  });

  test('rejects invalid JSON body', async () => {
    const res = await fetch(`${s.baseUrl}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  test('rejects envelopes that fail validation', async () => {
    const res = await fetch(`${s.baseUrl}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envelope_version: 1 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });

  test('persists valid envelope and broadcasts to subscribers', async () => {
    let received: unknown = null;
    s.broadcaster.subscribe({
      send: (payload) => {
        const msg = JSON.parse(payload);
        if (msg.type === 'event') received = msg.data;
      },
    });

    const res = await fetch(`${s.baseUrl}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeEnvelope()),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: number; timestamp: number };
    expect(body.id).toBeGreaterThan(0);
    expect(body.timestamp).toBeGreaterThan(0);
    expect(received).not.toBeNull();
    expect((received as { id: number }).id).toBe(body.id);
  });

  test('accepts non-canonical event_type with warning (no rejection)', async () => {
    const res = await fetch(`${s.baseUrl}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeEnvelope({ event_type: 'custom.thing' })),
    });
    expect(res.status).toBe(201);
  });
});
