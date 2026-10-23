import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDb, migrationsDone, migrationsFolder, openSqlite } from "./client";
import { applyPending, readMigrations, runMigrations } from "./migrate";

const tmpDb = () => join(mkdtempSync(join(tmpdir(), "migrate-test-")), "t.db");
const count = (path: string) => {
  const s = openSqlite(path);
  try { return (s.prepare(`SELECT count(*) AS n FROM "__drizzle_migrations"`).get() as { n: number }).n; } finally { s.close(); }
};
const tables = (s: ReturnType<typeof openSqlite>) =>
  (s.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);

// A second process running the migrations against `path`. It prints "ready"
// just before it starts, so the test can hold the write lock across that.
function migrateInChild(path: string): { ready: Promise<void>; done: Promise<{ code: number | null; out: string }> } {
  const dir = mkdtempSync(join(tmpdir(), "migrate-child-"));
  const script = join(dir, "child.ts");
  const src = resolve(__dirname);
  writeFileSync(script, [
    `import { openSqlite, migrationsFolder } from ${JSON.stringify(join(src, "client.ts"))};`,
    `import { runMigrations } from ${JSON.stringify(join(src, "migrate.ts"))};`,
    `const s = openSqlite(process.argv[2]!);`,
    `console.log("ready");`,
    `console.log("applied", runMigrations(s, migrationsFolder()));`,
  ].join("\n"));
  const tsx = resolve(process.cwd(), "node_modules/.bin/tsx");
  const child = spawn(tsx, [script, path], { cwd: process.cwd(), env: { ...process.env, OPENPAPR_MIGRATED: "" } });
  let out = "";
  let markReady: () => void = () => {};
  const ready = new Promise<void>((r) => { markReady = r; });
  child.stdout.on("data", (b) => { out += String(b); if (out.includes("ready")) markReady(); });
  child.stderr.on("data", (b) => { out += String(b); });
  const done = new Promise<{ code: number | null; out: string }>((r) => child.on("close", (code) => { markReady(); r({ code, out }); }));
  return { ready, done };
}

describe("runMigrations", () => {
  it("brings a new database up to date, then does nothing the second time", () => {
    const path = tmpDb();
    const s = openSqlite(path);
    const all = readMigrations(migrationsFolder()).length;
    expect(runMigrations(s, migrationsFolder())).toBe(all);
    expect(runMigrations(s, migrationsFolder())).toBe(0);
    expect(tables(s)).toContain("canvas_page_cache");
    s.close();
    expect(count(path)).toBe(all);
  });

  it("keeps drizzle's bookkeeping, so drizzle's own migrator agrees it is up to date", () => {
    const s = openSqlite(":memory:");
    runMigrations(s, migrationsFolder());
    // Would throw "table already exists" if it thought anything was pending.
    expect(() => migrate(drizzle(s), { migrationsFolder: migrationsFolder() })).not.toThrow();
  });

  it("carries on from a database drizzle migrated part of the way", () => {
    const s = openSqlite(":memory:");
    const all = readMigrations(migrationsFolder());
    s.exec("BEGIN IMMEDIATE");
    applyPending(s, all.slice(0, all.length - 1));
    s.exec("COMMIT");
    expect(runMigrations(s, migrationsFolder())).toBe(1);
  });

  it("is safe when another process migrates at the same moment", async () => {
    // The race drizzle's migrator loses: this database is one migration
    // behind, another process is applying it, and a second one starts. The
    // second must wait and then find nothing to do, not apply it again.
    const path = tmpDb();
    const all = readMigrations(migrationsFolder());
    const holder = openSqlite(path);
    holder.exec("BEGIN IMMEDIATE");
    applyPending(holder, all.slice(0, all.length - 1));
    holder.exec("COMMIT");

    holder.exec("BEGIN IMMEDIATE");
    const child = migrateInChild(path);
    await child.ready;
    await new Promise((r) => setTimeout(r, 400));   // the child is now waiting for the lock
    expect(applyPending(holder, all)).toBe(1);
    holder.exec("COMMIT");
    holder.close();

    const { code, out } = await child.done;
    expect(out).toContain("applied 0");
    expect(code).toBe(0);
    expect(count(path)).toBe(all.length);
  }, 30_000);
});

describe("createDb", () => {
  it("migrates by itself unless told the migrations are done", () => {
    expect(migrationsDone({ OPENPAPR_MIGRATED: "1" })).toBe(true);
    expect(migrationsDone({})).toBe(false);
    const path = tmpDb();
    createDb(path, { migrate: false });
    const s = openSqlite(path);
    expect(tables(s)).not.toContain("users");
    s.close();
    createDb(path, { migrate: true });
    expect(count(path)).toBe(readMigrations(migrationsFolder()).length);
  });
});
