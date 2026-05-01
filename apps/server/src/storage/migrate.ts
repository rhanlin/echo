/**
 * Versioned migration runner. Migrations live in `migrations/NNNN_*.sql` and
 * are applied in numeric order. Each file runs in a transaction; a failure
 * aborts startup.
 *
 * We register the schema_version row OUTSIDE the migration's own SQL so the
 * migration files stay focused on schema and dialect-portable.
 */

import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url).pathname;

const VERSION_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )
`;

interface MigrationFile {
  version: number;
  name: string;
  path: string;
}

export function migrate(db: Database, dir: string = MIGRATIONS_DIR): number[] {
  // Make sure the version table exists before we ask about applied versions.
  db.exec(VERSION_TABLE_DDL);

  const applied = new Set<number>(
    (db.prepare('SELECT version FROM schema_version').all() as { version: number }[]).map(
      (r) => r.version,
    ),
  );

  const files = discover(dir).filter((f) => !applied.has(f.version));

  const appliedNow: number[] = [];
  for (const file of files) {
    const sql = readFileSync(file.path, 'utf8');
    try {
      db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
          file.version,
          Date.now(),
        );
      })();
      appliedNow.push(file.version);
      console.log(`[migrate] applied ${file.name}`);
    } catch (error) {
      console.error(`[migrate] FAILED applying ${file.name}:`, error);
      throw error;
    }
  }
  return appliedNow;
}

function discover(dir: string): MigrationFile[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .map((name) => ({
      version: Number.parseInt(name.slice(0, 4), 10),
      name,
      path: join(dir, name),
    }))
    .sort((a, b) => a.version - b.version);
}
