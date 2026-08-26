// run: npx tsx scripts/generate-study-guide.ts <MODULE_CODE> [--user 1] [--dry]
//
// Generates a study guide for a module from its own lecture decks, using the
// configured OpenAI-compatible provider, and stores it in study_guides.
//
// Decks come from the files table, which includes files harvested out of
// announcement and page HTML — some courses publish their slides only that
// way, and those are exactly the modules with no guide yet.
//
// Two phases per deck: an outline call, then one call per section run
// concurrently. A single call asked for a whole chapter runs out of output
// budget and thins out towards the end.
import { and, eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { files, modules, users } from "../src/db/schema";
import { loadEnv } from "../src/lib/env";
import { decrypt } from "../src/lib/crypto";
import { createCanvasClient } from "../src/connectors/canvas/client";
import { extractPdfText } from "../src/lib/pdf-text";
import { createGuideGenerator, preferColourDeck, validateChapter } from "../src/enrich/study-guide";
import { upsertStudyGuide } from "../src/db/repo";
import { deckStem } from "../src/server/deck";
import { parseUserArg } from "../src/lib/cli";

const DECK_RE = /(lect|lecture|week|unit|topic|part|chapter|intro)/i;

async function main(): Promise<void> {
  const code = process.argv[2];
  if (!code || code.startsWith("--")) throw new Error("usage: generate-study-guide.ts <MODULE_CODE>");
  const userId = parseUserArg(process.argv);
  const dry = process.argv.includes("--dry");

  const env = loadEnv();
  if (!env.OPENAI_COMPAT_BASE_URL || !env.OPENAI_COMPAT_API_KEY) {
    throw new Error("Set OPENAI_COMPAT_BASE_URL and OPENAI_COMPAT_API_KEY");
  }
  const cfg = { baseUrl: env.OPENAI_COMPAT_BASE_URL, apiKey: env.OPENAI_COMPAT_API_KEY, model: env.OPENAI_COMPAT_MODEL };
  const gen = createGuideGenerator(cfg);

  const db = createDb(env.DATABASE_PATH);
  const mod = db.select().from(modules).where(and(eq(modules.userId, userId), eq(modules.code, code))).get();
  if (!mod) throw new Error(`no module ${code} for user ${userId}`);
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user?.canvasTokenEnc) throw new Error("no canvas token");
  const canvas = createCanvasClient(env.CANVAS_BASE_URL, decrypt(user.canvasTokenEnc, env.SECRET_KEY));

  const pdfs = db.select().from(files).where(eq(files.moduleId, mod.id)).all()
    .filter((f) => /\.pdf$/i.test(f.displayName) && DECK_RE.test(f.displayName))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { numeric: true }));
  const keep = new Set(preferColourDeck(pdfs.map((f) => f.displayName)));
  const decks = pdfs.filter((f) => keep.has(f.displayName));
  if (decks.length === 0) throw new Error(`no lecture decks recorded for ${code} — run a sync first`);

  console.log(`${code}: ${decks.length} deck(s) after dropping printable twins`);
  for (const d of decks) console.log(`  ${d.displayName} (${(d.sizeBytes ?? 0) / 1e6 | 0}MB)`);

  const chapters: string[] = [];
  for (const [i, deck] of decks.entries()) {
    const name = deckStem(deck.displayName);
    const fresh = await canvas.getFile(deck.canvasFileId);
    const text = await extractPdfText(await canvas.downloadFile(fresh.url));
    const pageCount = Number(text.match(/--\s*\d+\s*of\s*(\d+)\s*--/)?.[1] ?? 0);
    if (!text.trim() || !pageCount) {
      console.log(`  ${name}: no extractable text, skipping`);
      continue;
    }

    const outline = await gen.outline(name, text, pageCount);
    if (!outline) {
      console.log(`  ${name}: outline failed, skipping`);
      continue;
    }
    console.log(`  ${name}: "${outline.title}" — ${outline.sections.length} sections, ${pageCount} slides`);

    const t0 = Date.now();
    const bodies = await Promise.all(outline.sections.map((s, n) =>
      gen.section(name, text, pageCount, `${i + 1}.${n + 1} ${s.heading}`, s.covers, s.slides)
        .catch((e) => { console.log(`    section ${n + 1} failed: ${String(e).slice(0, 120)}`); return ""; })));

    const chapter = [`## ${i + 1}. ${outline.title}`, ...bodies.filter(Boolean)].join("\n\n");
    const problems = validateChapter(chapter, name, pageCount);
    console.log(`    ${Math.round((Date.now() - t0) / 1000)}s, ${chapter.length} chars` +
      (problems.length ? ` — PROBLEMS: ${problems.join("; ")}` : " — clean"));
    chapters.push(chapter);
  }

  if (chapters.length === 0) throw new Error("nothing generated");

  const preamble = `# ${mod.code} ${mod.name.replace(new RegExp(`^${mod.code}\\s*`), "").replace(/\s*\[\d+\]\s*$/, "")} — Study Guide\n\n` +
    `*Generated from the course's own lecture slides. Each hard idea is explained in plain language first, then precisely. ` +
    `Where a slide carries a figure worth seeing it is embedded inline, and a link marked "slide N" opens that slide in the source deck at exactly that page.*`;
  const markdown = [preamble, ...chapters].join("\n\n");
  const sourceNote = `${decks.length} deck${decks.length === 1 ? "" : "s"}, generated with ${cfg.model}`;

  console.log(`\ntotal: ${markdown.length} chars, ${chapters.length} chapters, ` +
    `${(markdown.match(/\]\(slide:/g) ?? []).length} citations, ${(markdown.match(/slide-img:/g) ?? []).length} embedded slides`);

  if (dry) {
    console.log("--dry: not written");
    return;
  }
  upsertStudyGuide(db, mod.id, markdown, sourceNote, Date.now());
  console.log(`stored for module ${mod.id} (${code})`);
}

void main();
