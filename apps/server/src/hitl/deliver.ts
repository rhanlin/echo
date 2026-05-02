/**
 * HITL response delivery: ship the human's response to the agent over the
 * channel the agent supplied in `human_in_the_loop.callback`.
 *
 * v1 behavior:
 *  - websocket: open WS, send single JSON frame, wait briefly for confirmation,
 *    then close.
 *  - webhook:   single HTTP request, default POST. Non-2xx = failure.
 *  - 5-second hard timeout for both.
 */

import type {
  HitlCallback,
  HumanInTheLoopResponse,
} from '@echo/envelope';

const TIMEOUT_MS = 5000;

export type DeliveryResult =
  | { ok: true }
  | { ok: false; error: string };

export async function deliverHitl(
  callback: HitlCallback,
  response: HumanInTheLoopResponse,
): Promise<DeliveryResult> {
  if (callback.kind === 'polling') return { ok: true };
  if (callback.kind === 'webhook') return deliverWebhook(callback, response);
  return deliverWebsocket(callback, response);
}

async function deliverWebhook(
  cb: Extract<HitlCallback, { kind: 'webhook' }>,
  response: HumanInTheLoopResponse,
): Promise<DeliveryResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(cb.url, {
      method: cb.method ?? 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, error: `webhook returned ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function deliverWebsocket(
  cb: Extract<HitlCallback, { kind: 'websocket' }>,
  response: HumanInTheLoopResponse,
): Promise<DeliveryResult> {
  return new Promise<DeliveryResult>((resolve) => {
    let settled = false;
    const settle = (result: DeliveryResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let ws: WebSocket;
    try {
      ws = new WebSocket(cb.url);
    } catch (err) {
      settle({ ok: false, error: errorMessage(err) });
      return;
    }

    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      settle({ ok: false, error: 'websocket delivery timed out' });
    }, TIMEOUT_MS);

    ws.addEventListener('open', () => {
      try {
        ws.send(JSON.stringify(response));
        // Close cleanly; consider the delivery successful once the frame is
        // queued. We don't wait for application-level ack in v1.
        ws.close(1000, 'delivered');
        clearTimeout(timer);
        settle({ ok: true });
      } catch (err) {
        clearTimeout(timer);
        settle({ ok: false, error: errorMessage(err) });
      }
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      settle({ ok: false, error: 'websocket error' });
    });
  });
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
