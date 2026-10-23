import type Database from "better-sqlite3";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";

// Applies the drizzle migrations that have not run yet, safely when two
// processes start on one file at once.
//
// drizzle's own migrate() reads the last applied migration BEFORE it begins
// its transaction, so the web server and the worker starting together could
// both decide a migration is pending; the second then fails on "table already
// exists" and crashes. Here the check and the changes happen inside one
// BEGIN IMMEDIATE: whoever gets the write lock first applies them, and the
// other waits (busy_timeout), then finds nothing left to do.
//
// The bookkeeping table and its columns are drizzle's, so a database migrated
// either way reads the same to both.

const TABLE = "__drizzle_migrations";

export function readMigrations(folder: string): MigrationMeta[] {
  return readMigrationFiles({ migrationsFolder: folder });
}

// The part that needs the write lock. The caller holds a transaction.
export function applyPending(sqlite: Database.Database, migrations: MigrationMeta[]): number {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS "${TABLE}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`);
  const last = sqlite.prepare(`SELECT created_at FROM "${TABLE}" ORDER BY created_at DESC LIMIT 1`).get() as { created_at: number | string } | undefined;
  const insert = sqlite.prepare(`INSERT INTO "${TABLE}" ("hash", "created_at") VALUES (?, ?)`);
  let applied = 0;
  for (const m of migrations) {
    if (last && Number(last.created_at) >= m.folderMillis) continue;
    for (const stmt of m.sql) if (stmt.trim()) sqlite.exec(stmt);
    insert.run(m.hash, m.folderMillis);
    applied++;
  }
  return applied;
}

// Returns how many migrations were applied (0 when already up to date).
export function runMigrations(sqlite: Database.Database, folder: string): number {
  const migrations = readMigrations(folder);
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    const n = applyPending(sqlite, migrations);
    sqlite.exec("COMMIT");
    return n;
  } catch (err) {
    sqlite.exec("ROLLBACK");
    throw err;
  }
}
