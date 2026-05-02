/**
 * Composition root.
 *
 * Wiring graph:
 *   config -> SqliteEventRepository (runs migrations)
 *          -> InMemoryBroadcaster (snapshots from repo)
 *          -> Hono app (HTTP routes)
 *          -> Bun.serve (HTTP + WebSocket /stream)
 */

import { Hono } from 'hono';
import { loadConfig } from './config';
import { SqliteEventRepository } from './storage/sqlite-repository';
import { InMemoryBroadcaster } from './broadcast/in-memory';
import { corsMiddleware } from './http/cors';
import { eventsRoutes } from './http/routes/events';
import { healthRoutes } from './http/routes/health';
import { hitlRoutes } from './http/routes/hitl';
import { makeStreamHandler, type StreamContext } from './ws/stream';

export interface BuiltApp {
  app: Hono;
  repo: SqliteEventRepository;
  broadcaster: InMemoryBroadcaster;
  config: ReturnType<typeof loadConfig>;
}

export function buildApp(env: NodeJS.ProcessEnv = process.env): BuiltApp {
  const config = loadConfig(env);
  const repo = new SqliteEventRepository({ dbPath: config.dbPath });
  const broadcaster = new InMemoryBroadcaster({
    snapshotProvider: () => repo.recent(config.wsSnapshotLimit),
  });

  const app = new Hono();
  app.use('*', corsMiddleware(config.corsOrigins));
  app.route('/', healthRoutes());
  app.route('/', eventsRoutes({ repo, broadcaster }));
  app.route('/', hitlRoutes({ repo, broadcaster }));

  return { app, repo, broadcaster, config };
}

export function startServer() {
  const built = buildApp();
  const wsHandler = makeStreamHandler(built.broadcaster);

  const server = Bun.serve<StreamContext, never>({
    port: built.config.port,
    idleTimeout: 120, // seconds; must exceed long-poll max wait (60s)
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === '/stream') {
        const ok = server.upgrade(req, {
          data: { snapshotLimit: built.config.wsSnapshotLimit },
        });
        if (ok) return undefined;
        return new Response('upgrade failed', { status: 400 });
      }
      return built.app.fetch(req);
    },
    websocket: wsHandler,
  });

  console.log(`[echo] listening on http://localhost:${server.port}`);
  console.log(`[echo] WebSocket stream:  ws://localhost:${server.port}/stream`);
  console.log(`[echo] DB: ${built.config.dbPath}`);
  return { server, ...built };
}

if (import.meta.main) {
  startServer();
}
