// run: npx tsx scripts/import-module-context.ts --dir ./context [--user 1]
//
// Loads per-module context notes from Markdown files, one per module, matched
// by the module code that prefixes each filename (IFS4103.md or
// IFS4103-notes.md -> module IFS4103). Keep the files wherever you like and
// re-run after editing: each import replaces that module's notes in place.
// The model's own profile of the module is a separate column and is not
// touched by this.
import { readdirSync, readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { modules } from "../src/db/schema";
import { setModuleNotes } from "../src/db/repo";
import { loadEnv } from "../src/lib/env";
import { parseUserArg } from "../src/lib/cli";

const argDir = (() => {
  const i = process.argv.indexOf("--dir");
  if (i === -1) throw new Error("usage: import-module-context.ts --dir <folder of CODE.md files> [--user 1]");
  return process.argv[i + 1]!;
})();
const userId = parseUserArg(process.argv);
const db = createDb(loadEnv().DATABASE_PATH);
const now = Date.now();

let imported = 0;
for (const file of readdirSync(argDir).filter((f) => f.endsWith(".md"))) {
  const code = file.split(/[-.]/)[0]!.toUpperCase();
  const mod = db.select().from(modules).where(eq(modules.code, code)).all().find((m) => m.userId === userId);
  if (!mod) {
    console.log(`skip ${file}: no module with code ${code} for user ${userId}`);
    continue;
  }
  const md = readFileSync(`${argDir}/${file}`, "utf8");
  setModuleNotes(db, userId, mod.id, md, now);
  console.log(`imported ${file} -> ${code} (module ${mod.id}, ${md.length} chars)`);
  imported++;
}
console.log(`\nDone: ${imported} module(s) updated from ${argDir}.`);
