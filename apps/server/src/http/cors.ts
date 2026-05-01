/**
 * Minimal CORS middleware for Hono.
 *
 * - `*` in origins => allow all (Access-Control-Allow-Origin: *).
 * - Otherwise reflects matching origins; non-matching get no ACAO header
 *   (browser will block; non-browser clients still work fine).
 * - Handles preflight OPTIONS by returning 204 with CORS headers.
 */

import type { MiddlewareHandler } from 'hono';

const ALLOWED_METHODS = 'GET, POST, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization';

export function corsMiddleware(allowedOrigins: string[]): MiddlewareHandler {
  const allowAll = allowedOrigins.includes('*');
  const allowed = new Set(allowedOrigins);

  return async (c, next) => {
    const requestOrigin = c.req.header('origin');
    const headers: Record<string, string> = {
      'Access-Control-Allow-Methods': ALLOWED_METHODS,
      'Access-Control-Allow-Headers': ALLOWED_HEADERS,
      'Access-Control-Max-Age': '86400',
    };

    if (allowAll) {
      headers['Access-Control-Allow-Origin'] = '*';
    } else if (requestOrigin && allowed.has(requestOrigin)) {
      headers['Access-Control-Allow-Origin'] = requestOrigin;
      headers['Vary'] = 'Origin';
    }

    if (c.req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    await next();

    for (const [k, v] of Object.entries(headers)) {
      c.res.headers.set(k, v);
    }
  };
}
