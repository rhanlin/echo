/**
 * Environment-driven configuration. All values have defaults so the server
 * runs out of the box for local development.
 */

export interface ServerConfig {
  port: number;
  dbPath: string;
  /** Allowed CORS origins. `['*']` means open. */
  corsOrigins: string[];
  /** Max events delivered in the initial WebSocket snapshot. */
  wsSnapshotLimit: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: parseIntOr(env.SERVER_PORT, 4000),
    dbPath: env.DB_PATH ?? 'events.db',
    corsOrigins: parseCsv(env.CORS_ORIGINS, ['*']),
    wsSnapshotLimit: parseIntOr(env.WS_SNAPSHOT_LIMIT, 300),
  };
}

function parseIntOr(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseCsv(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
