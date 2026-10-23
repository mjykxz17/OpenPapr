import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { runMigrations } from "./migrate";
import * as schema from "./schema";

// In production start.sh migrates once, before the web server and the worker
// start, and sets OPENPAPR_MIGRATED=1 so neither does it again. Everywhere
// else (dev, tests, scripts) the database migrates itself on open.
export const migrationsDone = (env: Record<string, string | undefined> = process.env) => env.OPENPAPR_MIGRATED === "1";

export const migrationsFolder = () => join(process.cwd(), "drizzle");

export function openSqlite(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  // The web server and the worker are two processes on one file. Without a
  // busy timeout, a write that meets the other's lock fails at once with
  // SQLITE_BUSY — a 500 on a page, or a skipped worker tick. With it, the
  // write waits its turn (WAL writes take milliseconds).
  sqlite.pragma("busy_timeout = 10000");
  sqlite.pragma("synchronous = NORMAL");
  return sqlite;
}

export function createDb(path: string, opts: { migrate?: boolean } = {}) {
  const sqlite = openSqlite(path);
  const db = drizzle(sqlite, { schema });
  if (opts.migrate ?? !migrationsDone()) runMigrations(sqlite, migrationsFolder());
  return db;
}
export type Db = ReturnType<typeof createDb>;
