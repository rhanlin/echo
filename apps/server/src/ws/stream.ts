/**
 * Bun WebSocket handlers for `/stream`.
 *
 * Bun's `websocket` config is a single object with handlers per event; we
 * receive a per-connection context object via `data`. On open we send a
 * snapshot; on close we run the unsubscribe stored in context.
 */

import type { ServerWebSocket, WebSocketHandler } from 'bun';
import type { Broadcaster } from '../broadcast/broadcaster';

export interface StreamContext {
  /** Filled on open; called on close. */
  unsubscribe?: () => void;
  snapshotLimit: number;
}

export function makeStreamHandler(
  broadcaster: Broadcaster,
): WebSocketHandler<StreamContext> {
  return {
    open(ws: ServerWebSocket<StreamContext>) {
      // Snapshot delivery: oldest-first, clamped by snapshotLimit.
      const all = broadcaster.snapshot();
      const events = all.slice(-ws.data.snapshotLimit);
      ws.send(JSON.stringify({ type: 'snapshot', data: events }));

      ws.data.unsubscribe = broadcaster.subscribe({
        send: (payload) => ws.send(payload),
      });
    },
    message() {
      // Inbound messages are ignored in v1.
    },
    close(ws: ServerWebSocket<StreamContext>) {
      ws.data.unsubscribe?.();
    },
  };
}
