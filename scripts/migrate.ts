// Brings the database up to date, once, before anything else opens it.
// start.sh runs this (bundled as dist/migrate.cjs) and only then starts the
// web server and the worker, telling both that migrations are done. Safe to
// run by hand too: a database already up to date is left as it is.
import { migrationsFolder, openSqlite } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";

const path = process.env.DATABASE_PATH ?? "data/openpapr.db";
const sqlite = openSqlite(path);
try {
  const n = runMigrations(sqlite, migrationsFolder());
  console.log(n ? `migrations: applied ${n} to ${path}` : `migrations: ${path} is up to date`);
} finally {
  sqlite.close();
}
