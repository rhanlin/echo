/**
 * ============================================================================
 * CLOUD MIGRATION BOUNDARY
 * ============================================================================
 *
 * This interface is the seam between the HTTP/broadcast layers and the
 * persistence layer. The v1 implementation is `SqliteEventRepository`; a
 * future `PostgresEventRepository` will be a drop-in replacement.
 *
 * Rules for this file:
 *  - Pure interface definitions only. No imports from `bun:sqlite`.
 *  - HTTP and broadcast layers MUST depend only on this file, never on a
 *    concrete repository.
 * ============================================================================
 */

import type {
  EventEnvelope,
  HumanInTheLoopResponse,
  StoredEvent,
} from '@echo/envelope';

export interface FilterOptions {
  agent_kinds: string[];
  source_apps: string[];
  /** Most recent N session ids only. */
  session_ids: string[];
  event_types: string[];
}

export interface EventRepository {
  /**
   * Persist a validated envelope. The repository assigns `id` and persists
   * `timestamp` (envelope's own timestamp if present, otherwise `receivedAt`).
   * If the envelope carries a `human_in_the_loop` block, the repository sets
   * `human_in_the_loop_status` to `{ status: 'pending' }`.
   */
  insert(envelope: EventEnvelope, receivedAt: number): StoredEvent;

  /**
   * Most recent events, ordered by timestamp ASC (oldest-first).
   * `limit` is the maximum number of rows; the caller is responsible for
   * clamping. The repository returns at most `limit`.
   */
  recent(limit: number): StoredEvent[];

  filterOptions(): FilterOptions;

  /**
   * Update the HITL status for an event. Returns the updated event, or
   * `null` if no event with that id exists.
   *
   * `nextStatus` ∈ {'responded', 'timeout', 'error'}; this method does NOT
   * support flipping back to 'pending'.
   */
  updateHitlResponse(
    id: number,
    response: HumanInTheLoopResponse,
    nextStatus: 'responded' | 'timeout' | 'error',
    error?: string,
  ): StoredEvent | null;

  /** Look up by id. Used by HITL response handler before updating. */
  findById(id: number): StoredEvent | null;
}
