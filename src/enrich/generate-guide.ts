import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { files, modules } from "../db/schema";
import type { CanvasClient } from "../connectors/canvas/client";
import { extractPdfText } from "../lib/pdf-text";
import { createGuideGenerator, figureSlides, selectGuideDecks, validateChapter, type CompatConfig } from "./study-guide-deps";

export type GuideProgress = {
  stage: string;
  decksTotal: number;
  decksDone: number;
  sectionsTotal: number;
  sectionsDone: number;
};

export type GuideResult = {
  markdown: string;
  sourceNote: string;
  problems: string[];
  decks: string[];
};

const MIN_DECK_SLIDES = 8;

// Shared by the CLI script and the worker, so an in-app generation and a
// terminal one produce the same guide. The caller decides what to do with
// progress: print it, or write it to guide_runs for the UI to poll.
export async function generateModuleGuide(opts: {
  db: Db;
  canvas: CanvasClient;
  cfg: CompatConfig;
  moduleId: number;
  onProgress?: (p: GuideProgress) => void;
  // Who the guide is for, from the student and module profiles.
  reader?: string | null;
}): Promise<GuideResult> {
  const { db, canvas, cfg, moduleId, onProgress } = opts;
  const gen = createGuideGenerator(cfg, opts.reader ?? null);
  const mod = db.select().from(modules).where(eq(modules.id, moduleId)).get();
  if (!mod) throw new Error(`no module ${moduleId}`);

  const decks = selectGuideDecks(db.select().from(files).where(eq(files.moduleId, moduleId)).all());
  if (decks.length === 0) throw new Error("no lecture decks recorded — run a sync first");

  const progress: GuideProgress = {
    stage: "Reading decks", decksTotal: decks.length, decksDone: 0, sectionsTotal: 0, sectionsDone: 0,
  };
  const report = () => onProgress?.({ ...progress });
  report();

  const chapters: string[] = [];
  const problems: string[] = [];
  const used: string[] = [];

  for (const [i, deck] of decks.entries()) {
    const name = deck.displayName.replace(/\.[^.]+$/, "");
    progress.stage = `Reading ${name}`;
    report();

    // Signed download urls expire, so the id is re-resolved rather than stored.
    const fresh = await canvas.getFile(deck.canvasFileId);
    const text = await extractPdfText(await canvas.downloadFile(fresh.url));
    const pageCount = Number(text.match(/--\s*\d+\s*of\s*(\d+)\s*--/)?.[1] ?? 0);
    // A three-slide handout is not a lecture. Asked to write a chapter from
    // one anyway, the model produced 44,000 characters citing slides 1-3 —
    // almost all of it invented. Refuse rather than generate fiction.
    if (pageCount > 0 && pageCount < MIN_DECK_SLIDES) {
      problems.push(`${name}: only ${pageCount} slides, too thin for a chapter`);
      progress.decksDone++;
      report();
      continue;
    }
    if (!text.trim() || !pageCount) {
      problems.push(`${name}: no extractable text`);
      progress.decksDone++;
      report();
      continue;
    }

    progress.stage = `Planning ${name}`;
    report();
    const outline = await gen.outline(name, text, pageCount);
    if (!outline) {
      problems.push(`${name}: outline failed`);
      progress.decksDone++;
      report();
      continue;
    }

    const figures = figureSlides(text);
    progress.sectionsTotal += outline.sections.length;
    report();

    // Sections run concurrently but report as they land, so the count climbs
    // steadily instead of jumping from 0 to done.
    const bodies = await Promise.all(outline.sections.map((s, n) =>
      gen.section(name, text, pageCount, `${i + 1}.${n + 1} ${s.heading}`, s.covers, s.slides, figures)
        .then((body) => {
          progress.sectionsDone++;
          progress.stage = `Writing ${name}: ${progress.sectionsDone} of ${progress.sectionsTotal} sections`;
          report();
          return body;
        })
        .catch((e) => {
          progress.sectionsDone++;
          problems.push(`${name} section ${n + 1}: ${String(e).slice(0, 80)}`);
          report();
          return "";
        })));

    const chapter = [`## ${i + 1}. ${outline.title}`, ...bodies.filter(Boolean)].join("\n\n");
    problems.push(...validateChapter(chapter, name, pageCount).map((p) => `${name}: ${p}`));
    chapters.push(chapter);
    used.push(name);
    progress.decksDone++;
    report();
  }

  if (chapters.length === 0) throw new Error("nothing generated");

  const cleanName = mod.name.replace(new RegExp(`^${mod.code}\\s*`), "").replace(/\s*\[\d+\]\s*$/, "").trim();
  const preamble = `# ${mod.code} ${cleanName} — Study Guide\n\n` +
    `*Generated from the course's own lecture slides. Each hard idea is explained in plain language first, then precisely. ` +
    `Where a slide carries a figure worth seeing it is embedded inline, and a link marked "slide N" opens that slide in the source deck at exactly that page.*`;

  progress.stage = "Done";
  report();

  return {
    markdown: [preamble, ...chapters].join("\n\n"),
    sourceNote: `${used.length} deck${used.length === 1 ? "" : "s"}, generated with ${cfg.model}`,
    problems,
    decks: used,
  };
}
