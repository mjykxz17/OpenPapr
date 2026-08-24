// run: npx tsx scripts/import-study-guides.ts [--dir ~/Desktop/pre-study] [--user 1]
//
// Loads Markdown study guides into the DB, one per module, matched by the
// module code that prefixes each filename (e.g. CS4239-*.md -> module CS4239).
// Idempotent: re-running replaces each guide in place. Provenance is taken
// from the file's first italic line (the "*Prepared from ...*" note).
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { modules } from "../src/db/schema";
import { upsertStudyGuide } from "../src/db/repo";
import { loadEnv } from "../src/lib/env";
import { parseUserArg } from "../src/lib/cli";

const argDir = (() => {
  const i = process.argv.indexOf("--dir");
  const raw = i >= 0 ? process.argv[i + 1] : "~/Desktop/pre-study";
  return raw.startsWith("~") ? join(homedir(), raw.slice(1)) : raw;
})();
const userId = parseUserArg(process.argv);
const db = createDb(loadEnv().DATABASE_PATH);
const now = Date.now();

// First markdown italic line, if any, trimmed of its asterisks — used as the
// provenance note shown under the guide.
function provenance(md: string): string | null {
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (t.startsWith("*") && t.endsWith("*") && t.length > 2) {
      const inner = t.slice(1, -1).trim();
      // Keep it short: first sentence only.
      return inner.split(/\.\s/)[0].replace(/^Prepared from /, "").slice(0, 120);
    }
    if (t && !t.startsWith("#")) break; // stop at first real prose paragraph
  }
  return null;
}

let imported = 0;
for (const file of readdirSync(argDir).filter((f) => f.endsWith(".md"))) {
  const code = file.split(/[-.]/)[0].toUpperCase(); // "CS4239-software-security.md" -> "CS4239"
  const mod = db.select().from(modules).where(eq(modules.code, code)).all().find((m) => m.userId === userId);
  if (!mod) {
    console.log(`skip ${file}: no module with code ${code} for user ${userId}`);
    continue;
  }
  const md = readFileSync(join(argDir, file), "utf8");
  upsertStudyGuide(db, mod.id, md, provenance(md), now);
  console.log(`imported ${file} -> ${code} (module ${mod.id}, ${md.length} chars)`);
  imported++;
}
console.log(`\nDone: ${imported} guide(s) imported from ${argDir}.`);
