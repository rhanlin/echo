/**
 * In-memory `Broadcaster`. Single-process v1 implementation.
 *
 * - `subscribe`/`publish` use a Set; subscribe returns an idempotent
 *   unsubscribe function.
 * - On send failure (e.g. closed socket), the client is removed; remaining
 *   subscribers are unaffected.
 * - `snapshot()` delegates to the repository.
 */

import type { StoredEvent } from '@echo/envelope';
import type {
  BroadcastClient,
  BroadcastMessage,
  Broadcaster,
} from './broadcaster';

export interface InMemoryBroadcasterOptions {
  /** Returns the snapshot for new subscribers. */
  snapshotProvider: () => StoredEvent[];
}

export class InMemoryBroadcaster implements Broadcaster {
  private readonly clients = new Set<BroadcastClient>();
  constructor(private readonly opts: InMemoryBroadcasterOptions) {}

  subscribe(client: BroadcastClient): () => void {
    this.clients.add(client);
    let alive = true;
    return () => {
      if (!alive) return;
      alive = false;
      this.clients.delete(client);
    };
  }

  publish(event: StoredEvent): void {
    const msg: BroadcastMessage = { type: 'event', data: event };
    const payload = JSON.stringify(msg);
    for (const client of [...this.clients]) {
      try {
        client.send(payload);
      } catch (err) {
        console.warn('[broadcast] dropping client after send failure:', err);
        this.clients.delete(client);
      }
    }
  }

  snapshot(): StoredEvent[] {
    return this.opts.snapshotProvider();
  }

  size(): number {
    return this.clients.size;
  }
}
