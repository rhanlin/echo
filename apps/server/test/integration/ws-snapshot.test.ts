import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { makeEnvelope, startTestServer, type TestServer } from './_helpers';

describe('WS /stream snapshot', () => {
  let s: TestServer;
  beforeAll(async () => {
    s = startTestServer({ WS_SNAPSHOT_LIMIT: '3' });
    for (let i = 0; i < 5; i++) {
      await fetch(`${s.baseUrl}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          makeEnvelope({ timestamp: 100 + i, raw_event_type: `e${i}` }),
        ),
      });
    }
  });
  afterAll(async () => {
    await s.stop();
  });

  test('on connect, receives snapshot of last N oldest-first', async () => {
    const ws = new WebSocket(s.wsUrl);
    const snapshot = await new Promise<{ type: string; data: { raw_event_type: string }[] }>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 3000);
        ws.addEventListener('message', (e) => {
          clearTimeout(timer);
          resolve(JSON.parse(String(e.data)));
        });
        ws.addEventListener('error', (e) => {
          clearTimeout(timer);
          reject(new Error(`ws error: ${String(e)}`));
        });
      },
    );

    expect(snapshot.type).toBe('snapshot');
    expect(snapshot.data).toHaveLength(3);
    expect(snapshot.data.map((e) => e.raw_event_type)).toEqual(['e2', 'e3', 'e4']);
    ws.close();
  });

  test('after connect, receives newly-published events', async () => {
    const ws = new WebSocket(s.wsUrl);
    const messages: { type: string; data: { raw_event_type: string } }[] = [];

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('open timeout')), 2000);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    ws.addEventListener('message', (e) => messages.push(JSON.parse(String(e.data))));

    // Wait briefly for snapshot then post a new event.
    await new Promise((r) => setTimeout(r, 50));
    await fetch(`${s.baseUrl}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeEnvelope({ raw_event_type: 'live-1' })),
    });

    // Wait for delivery.
    await new Promise((r) => setTimeout(r, 100));

    const liveEvent = messages.find(
      (m) => m.type === 'event' && m.data.raw_event_type === 'live-1',
    );
    expect(liveEvent).toBeTruthy();
    ws.close();
  });
});
