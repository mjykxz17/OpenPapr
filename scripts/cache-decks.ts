// run: npx tsx scripts/cache-decks.ts <MODULE_CODE> [--user 1]
//
// Downloads a module's PowerPoint (.pptx/.ppt) decks from Canvas, converts each
// to PDF with LibreOffice (headless), and caches them under
// data/deck-cache/<courseId>/<stem>.pdf — where the deck/slide API routes look
// first. This makes pptx-based courses (e.g. CS4238) work with the same slide
// citations and embedded-figure rendering as PDF-native courses.
//
// Needs LibreOffice. Set SOFFICE_BIN to override the binary path.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { modules, users } from "../src/db/schema";
import { loadEnv } from "../src/lib/env";
import { decrypt } from "../src/lib/crypto";
import { createCanvasClient } from "../src/connectors/canvas/client";
import { deckCachePath, deckStem } from "../src/server/deck";
import { parseUserArg } from "../src/lib/cli";

const SOFFICE = process.env.SOFFICE_BIN ?? "/Applications/LibreOffice.app/Contents/MacOS/soffice";
if (!existsSync(SOFFICE)) throw new Error(`LibreOffice not found at ${SOFFICE} (set SOFFICE_BIN)`);

const code = process.argv[2];
if (!code || code.startsWith("--")) throw new Error("usage: cache-decks.ts <MODULE_CODE>");
const userId = parseUserArg(process.argv);

const env = loadEnv();
const db = createDb(env.DATABASE_PATH);
const mod = db.select().from(modules).where(eq(modules.code, code)).all().find((m) => m.userId === userId);
if (!mod) throw new Error(`no module ${code} for user ${userId}`);
const user = db.select().from(users).where(eq(users.id, userId)).get();
if (!user?.canvasTokenEnc) throw new Error("no canvas token");
const canvas = createCanvasClient(env.CANVAS_BASE_URL, decrypt(user.canvasTokenEnc, env.SECRET_KEY));

const PPTX_RE = /\.pptx?$/i;

(async () => {
  const files = (await canvas.listCourseFiles(mod.canvasCourseId)).filter((f) => PPTX_RE.test(f.display_name));
  if (files.length === 0) {
    console.log(`No PowerPoint decks found for ${code}.`);
    return;
  }

  const outDir = dirname(deckCachePath(mod.canvasCourseId, "x"));
  mkdirSync(outDir, { recursive: true });
  const work = join(tmpdir(), `deck-convert-${mod.canvasCourseId}`);
  mkdirSync(work, { recursive: true });

  let done = 0;
  for (const f of files) {
    const stem = deckStem(f.display_name);
    const target = deckCachePath(mod.canvasCourseId, f.display_name);
    const srcPath = join(work, f.display_name);
    writeFileSync(srcPath, Buffer.from(await canvas.downloadFile(f.url)));
    // LibreOffice writes <basename>.pdf into --outdir; that matches our cache name.
    execFileSync(SOFFICE, ["--headless", "--convert-to", "pdf", "--outdir", outDir, srcPath], { stdio: "ignore" });
    console.log(existsSync(target) ? `converted ${f.display_name} -> ${stem}.pdf` : `FAILED ${f.display_name}`);
    if (existsSync(target)) done++;
  }
  console.log(`\nDone: ${done}/${files.length} decks cached under ${outDir}`);
})();
