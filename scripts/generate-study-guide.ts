// run: npx tsx scripts/generate-study-guide.ts <MODULE_CODE> [--user 1] [--dry]
//
// Generates a study guide for a module from its own lecture decks, using the
// configured OpenAI-compatible provider, and stores it in study_guides. The
// same code path as the in-app "Generate study guide" button, with progress
// printed here instead of written to guide_runs — so a guide written from a
// terminal and one written from the app are the same guide, module context
// and all.
import { and, eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { modules, users } from "../src/db/schema";
import { loadEnv } from "../src/lib/env";
import { decrypt } from "../src/lib/crypto";
import { createCanvasClient } from "../src/connectors/canvas/client";
import { generateModuleGuide } from "../src/enrich/generate-guide";
import { upsertStudyGuide } from "../src/db/repo";
import { parseUserArg } from "../src/lib/cli";

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

  const db = createDb(env.DATABASE_PATH);
  const mod = db.select().from(modules).where(and(eq(modules.userId, userId), eq(modules.code, code))).get();
  if (!mod) throw new Error(`no module ${code} for user ${userId}`);
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user?.canvasTokenEnc) throw new Error("no canvas token");
  const canvas = createCanvasClient(env.CANVAS_BASE_URL, decrypt(user.canvasTokenEnc, env.SECRET_KEY));

  const t0 = Date.now();
  let lastStage = "";
  const result = await generateModuleGuide({
    db, canvas, cfg, moduleId: mod.id,
    onProgress: (p) => {
      if (p.stage === lastStage) return;
      lastStage = p.stage;
      const sections = p.sectionsTotal ? ` (${p.sectionsDone}/${p.sectionsTotal} sections)` : "";
      console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${p.stage}${sections}`);
    },
  });

  const { markdown } = result;
  console.log(`\n${code}: ${result.decks.length} chapter(s) from ${result.decks.join(", ")}`);
  console.log(`total: ${markdown.length} chars, ` +
    `${(markdown.match(/\]\(slide:/g) ?? []).length} citations, ${(markdown.match(/slide-img:/g) ?? []).length} embedded slides`);
  if (result.problems.length) console.log(`problems:\n  ${result.problems.join("\n  ")}`);

  if (dry) {
    console.log("--dry: not written (the module profile was still updated)");
    return;
  }
  upsertStudyGuide(db, mod.id, markdown, result.sourceNote, Date.now());
  console.log(`stored for module ${mod.id} (${code})`);
}

void main();
