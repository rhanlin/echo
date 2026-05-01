/**
 * Test helper: build a fresh in-memory server stack on a real port.
 *
 * - Each call uses `:memory:` SQLite + a unique port.
 * - Returns the live `Bun.Server`, the base URL, and helpers for shutdown.
 */

import { buildApp } from '../../src/index';
import { makeStreamHandler, type StreamContext } from '../../src/ws/stream';

export interface TestServer {
  baseUrl: string;
  wsUrl: string;
  port: number;
  stop: () => Promise<void>;
  repo: ReturnType<typeof buildApp>['repo'];
  broadcaster: ReturnType<typeof buildApp>['broadcaster'];
}

export function startTestServer(env: Partial<NodeJS.ProcessEnv> = {}): TestServer {
  const built = buildApp({
    SERVER_PORT: '0',
    DB_PATH: ':memory:',
    CORS_ORIGINS: '*',
    WS_SNAPSHOT_LIMIT: '300',
    ...env,
  } as NodeJS.ProcessEnv);

  const wsHandler = makeStreamHandler(built.broadcaster);

  const server = Bun.serve<StreamContext, never>({
    port: 0,
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

  return {
    baseUrl: `http://localhost:${server.port}`,
    wsUrl: `ws://localhost:${server.port}/stream`,
    port: server.port,
    repo: built.repo,
    broadcaster: built.broadcaster,
    stop: async () => {
      server.stop(true);
      built.repo.close();
    },
  };
}

export function makeEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    envelope_version: 1,
    agent_kind: 'claude-code',
    agent_version: '1.0.0',
    source_app: 'test-app',
    session_id: 'sess-1',
    event_type: 'tool.pre_use',
    raw_event_type: 'PreToolUse',
    payload: { tool: 'Bash' },
    ...overrides,
  };
}
