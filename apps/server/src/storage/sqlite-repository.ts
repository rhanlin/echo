/**
 * SQLite-backed `EventRepository`. v1 implementation.
 *
 * Variable-shape fields (payload, normalized, transcript, transcript_ref,
 * human_in_the_loop, human_in_the_loop_status) are stored as JSON-encoded
 * TEXT columns. On Postgres they will become JSONB without a column-shape
 * change.
 */

import { Database } from 'bun:sqlite';
import type {
  EventEnvelope,
  HumanInTheLoopResponse,
  HumanInTheLoopStatus,
  StoredEvent,
} from '@echo/envelope';

import type { EventRepository, FilterOptions } from './repository';
import { migrate } from './migrate';

export interface SqliteRepoOptions {
  /** Path to the SQLite file. Use `:memory:` for tests. */
  dbPath: string;
}

export class SqliteEventRepository implements EventRepository {
  readonly db: Database;

  private insertStmt!: ReturnType<Database['prepare']>;
  private recentStmt!: ReturnType<Database['prepare']>;
  private findByIdStmt!: ReturnType<Database['prepare']>;
  private updateHitlStmt!: ReturnType<Database['prepare']>;

  constructor(opts: SqliteRepoOptions) {
    this.db = new Database(opts.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');

    migrate(this.db);

    this.prepareStatements();
  }

  private prepareStatements(): void {
    this.insertStmt = this.db.prepare(`
      INSERT INTO events (
        envelope_version, agent_kind, agent_version, source_app, session_id,
        event_type, raw_event_type, timestamp,
        payload, normalized, summary, transcript, transcript_ref,
        human_in_the_loop, human_in_the_loop_status
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?
      )
    `);

    this.recentStmt = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM events ORDER BY timestamp DESC LIMIT ?
      ) AS recent
      ORDER BY timestamp ASC
    `);

    this.findByIdStmt = this.db.prepare(`SELECT * FROM events WHERE id = ?`);

    this.updateHitlStmt = this.db.prepare(`
      UPDATE events SET human_in_the_loop_status = ? WHERE id = ?
    `);
  }

  insert(envelope: EventEnvelope, receivedAt: number): StoredEvent {
    const ts = envelope.timestamp ?? receivedAt;

    const initialStatus: HumanInTheLoopStatus | undefined = envelope.human_in_the_loop
      ? { status: 'pending' }
      : undefined;

    const result = this.insertStmt.run(
      envelope.envelope_version,
      envelope.agent_kind,
      envelope.agent_version,
      envelope.source_app,
      envelope.session_id,
      envelope.event_type,
      envelope.raw_event_type,
      ts,
      JSON.stringify(envelope.payload),
      jsonOrNull(envelope.normalized),
      envelope.summary ?? null,
      jsonOrNull(envelope.transcript),
      jsonOrNull(envelope.transcript_ref),
      jsonOrNull(envelope.human_in_the_loop),
      jsonOrNull(initialStatus),
    );

    return {
      ...envelope,
      id: Number(result.lastInsertRowid),
      timestamp: ts,
      ...(initialStatus ? { human_in_the_loop_status: initialStatus } : {}),
    };
  }

  recent(limit: number): StoredEvent[] {
    const rows = this.recentStmt.all(limit) as EventRow[];
    return rows.map(rowToStoredEvent);
  }

  findById(id: number): StoredEvent | null {
    const row = this.findByIdStmt.get(id) as EventRow | null;
    return row ? rowToStoredEvent(row) : null;
  }

  filterOptions(): FilterOptions {
    const distinct = (col: string): string[] =>
      (this.db.prepare(`SELECT DISTINCT ${col} AS v FROM events ORDER BY v`).all() as {
        v: string;
      }[]).map((r) => r.v);

    const recentSessions = (
      this.db
        .prepare(
          `SELECT DISTINCT session_id AS v FROM events ORDER BY timestamp DESC LIMIT 300`,
        )
        .all() as { v: string }[]
    ).map((r) => r.v);

    return {
      agent_kinds: distinct('agent_kind'),
      source_apps: distinct('source_app'),
      session_ids: recentSessions,
      event_types: distinct('event_type'),
    };
  }

  updateHitlResponse(
    id: number,
    response: HumanInTheLoopResponse,
    nextStatus: 'responded' | 'timeout' | 'error',
    error?: string,
  ): StoredEvent | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const status: HumanInTheLoopStatus = {
      status: nextStatus,
      responded_at: response.responded_at ?? Date.now(),
      response,
      ...(error ? { error } : {}),
    };

    this.updateHitlStmt.run(JSON.stringify(status), id);

    return { ...existing, human_in_the_loop_status: status };
  }

  close(): void {
    this.db.close();
  }
}

interface EventRow {
  id: number;
  envelope_version: number;
  agent_kind: string;
  agent_version: string;
  source_app: string;
  session_id: string;
  event_type: string;
  raw_event_type: string;
  timestamp: number;
  payload: string;
  normalized: string | null;
  summary: string | null;
  transcript: string | null;
  transcript_ref: string | null;
  human_in_the_loop: string | null;
  human_in_the_loop_status: string | null;
}

function jsonOrNull(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function parseOrUndef<T>(value: string | null): T | undefined {
  return value === null ? undefined : (JSON.parse(value) as T);
}

function rowToStoredEvent(row: EventRow): StoredEvent {
  return {
    id: row.id,
    envelope_version: row.envelope_version as 1,
    agent_kind: row.agent_kind,
    agent_version: row.agent_version,
    source_app: row.source_app,
    session_id: row.session_id,
    event_type: row.event_type,
    raw_event_type: row.raw_event_type,
    timestamp: row.timestamp,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    normalized: parseOrUndef(row.normalized),
    summary: row.summary ?? undefined,
    transcript: parseOrUndef(row.transcript),
    transcript_ref: parseOrUndef(row.transcript_ref),
    human_in_the_loop: parseOrUndef(row.human_in_the_loop),
    human_in_the_loop_status: parseOrUndef(row.human_in_the_loop_status),
  };
}
