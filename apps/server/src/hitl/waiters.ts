/**
 * In-process waiter registry for polling HITL responses.
 *
 * When an agent uses callback.kind === "polling", it long-polls
 * GET /events/:id/response. This module holds the in-flight resolvers
 * and wakes them immediately when a human posts to POST /events/:id/respond.
 *
 * Design mirrors the broadcaster: a Map<id, Set<resolver>> that a future
 * change can swap for a Redis-backed implementation behind the same interface
 * without touching the route handlers.
 *
 * Spec coverage: polling-callback-kind/specs/human-in-the-loop/spec.md
 */

type Resolver = (response: object) => void;

const waiters = new Map<number, Set<Resolver>>();

/**
 * Register a resolver that will be called when a response is recorded for
 * `eventId`. Returns a cleanup function that MUST be called on timeout,
 * client-disconnect, or after the resolver is invoked — whichever comes
 * first. Calling cleanup after `wake()` already removed the entry is safe
 * (no-op).
 */
export function register(eventId: number, resolve: Resolver): () => void {
  let set = waiters.get(eventId);
  if (!set) {
    set = new Set();
    waiters.set(eventId, set);
  }
  set.add(resolve);

  return () => {
    const s = waiters.get(eventId);
    if (!s) return;
    s.delete(resolve);
    if (s.size === 0) waiters.delete(eventId);
  };
}

/**
 * Wake every resolver registered for `eventId` with `response`. Clears the
 * entry from the map first so cleanup calls from concurrent timeouts are
 * no-ops.
 */
export function wake(eventId: number, response: object): void {
  const set = waiters.get(eventId);
  if (!set) return;
  const resolvers = [...set];
  waiters.delete(eventId);
  for (const resolve of resolvers) {
    resolve(response);
  }
}

/**
 * Diagnostic helper. Returns the number of registered waiters for a specific
 * event id, or the total across all events when called without an argument.
 */
export function count(eventId?: number): number {
  if (eventId !== undefined) {
    return waiters.get(eventId)?.size ?? 0;
  }
  let total = 0;
  for (const s of waiters.values()) total += s.size;
  return total;
}
