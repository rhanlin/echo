import { describe, expect, test } from 'bun:test';
import type { EventEnvelope } from '@echo/envelope';
import { SqliteEventRepository } from '../src/storage/sqlite-repository';

function makeRepo() {
  return new SqliteEventRepository({ dbPath: ':memory:' });
}

function envelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    envelope_version: 1,
    agent_kind: 'claude-code',
    agent_version: '1.0.0',
    source_app: 'app-a',
    session_id: 'sess-1',
    event_type: 'tool.pre_use',
    raw_event_type: 'PreToolUse',
    payload: { tool: 'Bash' },
    ...overrides,
  };
}

describe('SqliteEventRepository', () => {
  test('insert assigns id and round-trips fields', () => {
    const repo = makeRepo();
    const stored = repo.insert(
      envelope({
        normalized: { tool_name: 'Bash' },
        summary: 'hi',
      }),
      111,
    );
    expect(stored.id).toBeGreaterThan(0);
    expect(stored.timestamp).toBe(111);

    const found = repo.findById(stored.id);
    expect(found).not.toBeNull();
    expect(found!.payload).toEqual({ tool: 'Bash' });
    expect(found!.normalized).toEqual({ tool_name: 'Bash' });
    expect(found!.summary).toBe('hi');

    repo.close();
  });

  test('insert preserves envelope timestamp when supplied', () => {
    const repo = makeRepo();
    const stored = repo.insert(envelope({ timestamp: 999 }), 111);
    expect(stored.timestamp).toBe(999);
    repo.close();
  });

  test('recent returns oldest-first and respects limit', () => {
    const repo = makeRepo();
    for (let i = 0; i < 5; i++) {
      repo.insert(envelope({ timestamp: 1000 + i, raw_event_type: `e${i}` }), 0);
    }
    const recent = repo.recent(3);
    expect(recent).toHaveLength(3);
    expect(recent[0]!.timestamp).toBeLessThan(recent[2]!.timestamp);
    expect(recent[2]!.raw_event_type).toBe('e4');
    repo.close();
  });

  test('filterOptions returns distinct values', () => {
    const repo = makeRepo();
    repo.insert(envelope({ agent_kind: 'claude-code', source_app: 'a' }), 1);
    repo.insert(envelope({ agent_kind: 'cursor', source_app: 'b' }), 2);
    repo.insert(envelope({ agent_kind: 'claude-code', source_app: 'a' }), 3);

    const opts = repo.filterOptions();
    expect(opts.agent_kinds.sort()).toEqual(['claude-code', 'cursor']);
    expect(opts.source_apps.sort()).toEqual(['a', 'b']);
    expect(opts.event_types).toEqual(['tool.pre_use']);
    repo.close();
  });

  test('HITL initialization and update flow', () => {
    const repo = makeRepo();
    const stored = repo.insert(
      envelope({
        human_in_the_loop: {
          question: 'allow?',
          type: 'permission',
          callback: { kind: 'websocket', url: 'ws://x' },
        },
      }),
      0,
    );
    expect(stored.human_in_the_loop_status).toEqual({ status: 'pending' });

    const updated = repo.updateHitlResponse(
      stored.id,
      { permission: true, responded_at: 555 },
      'responded',
    );
    expect(updated).not.toBeNull();
    expect(updated!.human_in_the_loop_status?.status).toBe('responded');
    expect(updated!.human_in_the_loop_status?.responded_at).toBe(555);
    expect(updated!.human_in_the_loop_status?.response?.permission).toBe(true);

    expect(repo.updateHitlResponse(99999, {}, 'responded')).toBeNull();
    repo.close();
  });

  test('recent uses idx_timestamp', () => {
    const repo = makeRepo();
    const plan = repo.db
      .prepare('EXPLAIN QUERY PLAN SELECT * FROM events ORDER BY timestamp DESC LIMIT 10')
      .all() as { detail: string }[];
    const detail = plan.map((r) => r.detail).join(' | ');
    // SQLite reports use of "idx_events_timestamp" or "USING INDEX" for the ordered query.
    expect(detail.toLowerCase()).toContain('idx_events_timestamp');
    repo.close();
  });
});
