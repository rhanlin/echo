import { Hono } from 'hono';
import type { EventRepository } from '../../storage/repository';
import type { Broadcaster } from '../../broadcast/broadcaster';
import { deliverHitl } from '../../hitl/deliver';
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

    deps.broadcaster.publish(updated);

    // Always return 200 — the human's decision is recorded even if callback
    // delivery failed. Delivery status is visible in human_in_the_loop_status.
    return c.json(updated, 200);
  });

  return app;
}
