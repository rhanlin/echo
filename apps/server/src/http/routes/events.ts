import { Hono } from 'hono';
import type { EventRepository } from '../../storage/repository';
import type { Broadcaster } from '../../broadcast/broadcaster';
import { validateEnvelope } from '../../envelope/validate';
import { isCanonicalEventType } from '@echo/envelope';

export interface EventsRouteDeps {
  repo: EventRepository;
  broadcaster: Broadcaster;
}

const RECENT_DEFAULT = 300;
const RECENT_MAX = 1000;

export function eventsRoutes(deps: EventsRouteDeps): Hono {
  const app = new Hono();

  app.post('/events', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }

    const result = validateEnvelope(body);
    if (!result.ok) return c.json({ error: result.error }, 400);

    if (!isCanonicalEventType(result.envelope.event_type)) {
      console.warn(
        `[ingest] non-canonical event_type "${result.envelope.event_type}" from agent_kind="${result.envelope.agent_kind}"`,
      );
    }

    // TODO(v2): enforce MAX_PAYLOAD_BYTES env var to cap incoming body size
    let stored;
    try {
      stored = deps.repo.insert(result.envelope, Date.now());
    } catch (err) {
      const { agent_kind, source_app, session_id, raw_event_type } = result.envelope;
      console.error('[ingest] repository error', { agent_kind, source_app, session_id, raw_event_type }, err);
      return c.json({ error: 'internal server error' }, 500);
    }
    deps.broadcaster.publish(stored);
    return c.json(stored, 201);
  });

  app.get('/events/recent', (c) => {
    const limitParam = c.req.query('limit');
    let limit = limitParam ? Number.parseInt(limitParam, 10) : RECENT_DEFAULT;
    if (!Number.isFinite(limit) || limit <= 0) limit = RECENT_DEFAULT;
    if (limit > RECENT_MAX) limit = RECENT_MAX;

    return c.json(deps.repo.recent(limit));
  });

  app.get('/events/filter-options', (c) => {
    return c.json(deps.repo.filterOptions());
  });

  return app;
}
