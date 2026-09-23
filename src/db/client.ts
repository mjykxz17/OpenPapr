import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import * as schema from "./schema";

export function createDb(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  // The web server and the worker are two processes on one file. Without a
  // busy timeout, a write that meets the other's lock fails at once with
  // SQLITE_BUSY — a 500 on a page, or a skipped worker tick. With it, the
  // write waits its turn (WAL writes take milliseconds).
  sqlite.pragma("busy_timeout = 10000");
  sqlite.pragma("synchronous = NORMAL");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });
  return db;
}
export type Db = ReturnType<typeof createDb>;
