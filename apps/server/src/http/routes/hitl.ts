import { Hono } from 'hono';
import type { EventRepository } from '../../storage/repository';
import type { Broadcaster } from '../../broadcast/broadcaster';
import { deliverHitl } from '../../hitl/deliver';
import { register, wake } from '../../hitl/waiters';
import type { HumanInTheLoopResponse } from '@echo/envelope';

export interface HitlRouteDeps {
  repo: EventRepository;
  broadcaster: Broadcaster;
}

export function hitlRoutes(deps: HitlRouteDeps): Hono {
  const app = new Hono();

  app.post('/events/:id/respond', async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'invalid id' }, 400);

    const event = deps.repo.findById(id);
    if (!event) return c.json({ error: 'event not found' }, 404);
    if (!event.human_in_the_loop) {
      return c.json({ error: 'event has no human_in_the_loop block' }, 400);
    }
    if (
      event.human_in_the_loop_status &&
      event.human_in_the_loop_status.status !== 'pending'
    ) {
      return c.json(
        { error: `already resolved with status="${event.human_in_the_loop_status.status}"` },
        409,
      );
    }

    let body: HumanInTheLoopResponse;
    try {
      body = (await c.req.json()) as HumanInTheLoopResponse;
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof body !== 'object' || body === null) {
      return c.json({ error: 'response must be an object' }, 400);
    }

    const responded_at = body.responded_at ?? Date.now();
    const filledResponse: HumanInTheLoopResponse = { ...body, responded_at };

    const delivery = await deliverHitl(event.human_in_the_loop.callback, filledResponse);

    const nextStatus = delivery.ok ? 'responded' : 'error';
    const updated = deps.repo.updateHitlResponse(
      id,
      filledResponse,
      nextStatus,
      delivery.ok ? undefined : delivery.error,
    );
    if (!updated) return c.json({ error: 'event vanished mid-update' }, 500);

    // Wake any long-polling agents BEFORE broadcasting to dashboard.
    // Persist already happened above; re-pollers see the recorded response.
    wake(id, filledResponse);

    deps.broadcaster.publish(updated);

    // Always return 200 — the human's decision is recorded even if callback
    // delivery failed. Delivery status is visible in human_in_the_loop_status.
    return c.json(updated, 200);
  });

  // -------------------------------------------------------------------------
  // GET /events/:id/response  — long-poll endpoint for polling callback kind.
  // Returns the recorded HITL response once available, or 408 on timeout.
  // -------------------------------------------------------------------------
  app.get('/events/:id/response', async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'invalid id' }, 400);

    const event = deps.repo.findById(id);
    if (!event) return c.json({ error: 'event not found' }, 404);
    if (!event.human_in_the_loop) {
      return c.json({ error: 'event does not have a HITL request' }, 400);
    }

    const noStore = { 'Cache-Control': 'no-store' };

    // Already answered — return immediately (idempotent).
    if (event.human_in_the_loop_status?.status === 'responded') {
      return c.json(event.human_in_the_loop_status.response ?? {}, 200, noStore);
    }

    const wait = parseWait(c.req.query('wait'));

    if (wait === 0) {
      return c.json({ error: 'timeout' }, 408, noStore);
    }

    // Long-poll: hold connection until woken or timed out.
    let resolveWaiter!: (r: object | null) => void;
    const waiterPromise = new Promise<object | null>((res) => {
      resolveWaiter = res;
    });

    const cleanup = register(id, (response) => {
      clearTimeout(timer);
      resolveWaiter(response);
    });

    const timer = setTimeout(() => {
      cleanup();
      resolveWaiter(null);
    }, wait * 1000);

    c.req.raw.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      cleanup();
      resolveWaiter(null);
    });

    const response = await waiterPromise;

    // Cleanup is already called by whichever path resolved the promise, but
    // calling it again is safe (no-op after the set entry is gone).
    cleanup();

    if (response === null) {
      return c.json({ error: 'timeout' }, 408, noStore);
    }
    return c.json(response, 200, noStore);
  });

  return app;
}

// ---------------------------------------------------------------------------
// Long-poll helper: parse the `wait` query-param and clamp to [0, 60].
// ---------------------------------------------------------------------------
function parseWait(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '30', 10);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(Math.max(parsed, 0), 60);
}