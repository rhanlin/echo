import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { makeEnvelope, startTestServer, type TestServer } from './_helpers';

describe('GET /events/recent', () => {
  let s: TestServer;
  beforeAll(async () => {
    s = startTestServer();
    for (let i = 0; i < 25; i++) {
      await fetch(`${s.baseUrl}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          makeEnvelope({ timestamp: 1000 + i, raw_event_type: `e${i}` }),
        ),
      });
    }
  });
  afterAll(async () => {
    await s.stop();
  });

  test('returns oldest-first by default', async () => {
    const res = await fetch(`${s.baseUrl}/events/recent`);
    const body = (await res.json()) as { timestamp: number }[];
    expect(body.length).toBe(25);
    for (let i = 1; i < body.length; i++) {
      expect(body[i]!.timestamp).toBeGreaterThanOrEqual(body[i - 1]!.timestamp);
    }
  });

  test('honors custom limit', async () => {
    const res = await fetch(`${s.baseUrl}/events/recent?limit=5`);
    const body = (await res.json()) as { timestamp: number; raw_event_type: string }[];
    expect(body.length).toBe(5);
    // Should be the LAST 5 events, oldest-first within that window.
    expect(body[body.length - 1]!.raw_event_type).toBe('e24');
  });

  test('clamps limits above max', async () => {
    const res = await fetch(`${s.baseUrl}/events/recent?limit=100000`);
    const body = (await res.json()) as unknown[];
    expect(body.length).toBe(25); // we only inserted 25
  });

  test('falls back to default for invalid limits', async () => {
    const res = await fetch(`${s.baseUrl}/events/recent?limit=abc`);
    expect(res.status).toBe(200);
  });
});
