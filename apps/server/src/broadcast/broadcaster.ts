/**
 * ============================================================================
 * CLOUD MIGRATION BOUNDARY
 * ============================================================================
 *
 * The `Broadcaster` interface is the seam between the HTTP/WS layers and the
 * fan-out mechanism. The v1 implementation is `InMemoryBroadcaster`; a future
 * `RedisPubSubBroadcaster` will be a drop-in replacement for multi-replica
 * deployments.
 *
 * Rules for this file:
 *  - Pure interface definitions only.
 *  - HTTP and WS handlers MUST depend only on this file, never on a
 *    concrete broadcaster.
 * ============================================================================
 */

import type { StoredEvent } from '@echo/envelope';

export type BroadcastMessage =
  | { type: 'snapshot'; data: StoredEvent[] }
  | { type: 'event'; data: StoredEvent };

/** A broadcast subscriber. The broadcaster sends JSON-encoded messages here. */
export interface BroadcastClient {
  send(payload: string): void;
  /** Optional disconnect signal so impls can self-cleanup. */
  readyState?: number;
}

export interface Broadcaster {
  /** Register a client. Returns an unsubscribe function (idempotent). */
  subscribe(client: BroadcastClient): () => void;

  /** Push a single event to all subscribers. Failed sends drop the client. */
  publish(event: StoredEvent): void;

  /** Snapshot used for newly-connected clients. */
  snapshot(): StoredEvent[];

  /** Number of currently-subscribed clients. Useful for tests/diagnostics. */
  size(): number;
}
