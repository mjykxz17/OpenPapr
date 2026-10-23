import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { files, modules } from "../db/schema";
import type { CanvasClient } from "../connectors/canvas/client";
import { extractPdfText } from "../lib/pdf-text";
import { renderPdfPage } from "../lib/pdf-render";
import { citeDeck } from "../lib/slide-citation";
import { modelsServed, startServedLog } from "./openai-compat";
import { cleanCitations, createGuideGenerator, selectGuideDecks, validateChapter, type CompatConfig, type DeckPlan, type DeckWritten } from "./study-guide-deps";

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

// What one deck's writing leaves for the chapter: its sections in order, then
// its key points. Every section that could not be written — failed, or came
// back empty — is a problem line and counts as missing, so the chapter is
// tried again; one cut off at the token budget, or key points that failed,
// is only a problem line.
export function deckOutcome(name: string, w: DeckWritten): { parts: string[]; problems: string[]; missing: number } {
  const problems: string[] = [];
  let missing = 0;
  w.errors.forEach((e, k) => {
    if (e === null && (w.bodies[k] ?? "").trim() !== "") return;
    problems.push(`${name} section ${k + 1}: ${(e ?? "nothing was written").slice(0, 80)}`);
    missing++;
  });
  for (const k of w.cut) problems.push(`${name} section ${k + 1}: cut off at the model's token budget, kept to its last whole paragraph`);
  if (w.recapError) problems.push(`${name} key points: ${w.recapError.slice(0, 80)}`);
  const parts = w.bodies.filter((b): b is string => b !== null && b.trim() !== "");
  return { parts: w.recap ? [...parts, w.recap] : parts, problems, missing };
}

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
  // The files the student picked. Without it, the module's lecture decks.
  fileIds?: number[] | null;
  // PDF bytes for a file — lets the worker serve decks from its cache and
  // convert PowerPoint. Without it, PDFs are downloaded from Canvas.
  loadPdf?: (file: typeof files.$inferSelect) => Promise<Uint8Array>;
}): Promise<GuideResult> {
  const { db, canvas, cfg, moduleId, onProgress } = opts;
  const gen = createGuideGenerator(cfg, opts.reader ?? null);
  startServedLog(cfg);
  const mod = db.select().from(modules).where(eq(modules.id, moduleId)).get();
  if (!mod) throw new Error(`no module ${moduleId}`);

  const all = db.select().from(files).where(eq(files.moduleId, moduleId)).all();
  const chosen = opts.fileIds?.length ? new Set(opts.fileIds) : null;
  const decks = chosen
    ? all.filter((f) => chosen.has(f.id)).sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { numeric: true }))
    : selectGuideDecks(all);
  if (decks.length === 0) throw new Error(chosen ? "none of the chosen files are in this module any more" : "no lecture decks recorded — run a sync first");

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

    let text: string;
    let bytes: Uint8Array;
    try {
      if (opts.loadPdf) {
        bytes = await opts.loadPdf(deck);
      } else {
        // Signed download urls expire, so the id is re-resolved rather than stored.
        const fresh = await canvas.getFile(deck.canvasFileId);
        bytes = await canvas.downloadFile(fresh.url);
      }
      // pdf.js may take over the buffer it is given, so it reads a copy; the
      // original stays for rendering figure slides.
      text = await extractPdfText(bytes.slice());
    } catch (err) {
      problems.push(`${name}: could not be read (${String(err instanceof Error ? err.message : err).slice(0, 80)})`);
      progress.decksDone++;
      report();
      continue;
    }
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

    progress.sectionsTotal += outline.sections.length;
    report();

    const cite = citeDeck(name);
    const plan: DeckPlan = {
      deckName: cite, deckText: text, pageCount,
      sections: outline.sections.map((s, n) => ({ number: `${i + 1}.${n + 1}`, heading: s.heading, covers: s.covers, slides: s.slides })),
      pageImage: (page) => renderPdfPage(bytes.slice(), page, 1.25),
    };
    // Sections report as they land, so the count climbs steadily instead of
    // jumping from 0 to done.
    const written = await gen.writeDeck(plan, {
      recap: `${i + 1}.${outline.sections.length + 1}`,
      onSection: () => {
        progress.sectionsDone++;
        progress.stage = `Writing ${name}: ${progress.sectionsDone} of ${progress.sectionsTotal} sections`;
        report();
      },
    });
    const got = deckOutcome(name, written);
    problems.push(...got.problems);

    const chapter = cleanCitations([`## ${i + 1}. ${outline.title}`, ...got.parts].join("\n\n"), new Map([[cite, pageCount]])).markdown;
    problems.push(...validateChapter(chapter, citeDeck(name), pageCount).map((p) => `${name}: ${p}`));
    chapters.push(chapter);
    used.push(name);
    progress.decksDone++;
    report();
  }

  if (chapters.length === 0) throw new Error("nothing generated");

  const cleanName = mod.name.replace(new RegExp(`^${mod.code}\\s*`), "").replace(/\s*\[\d+\]\s*$/, "").trim();
  const preamble = `# ${mod.code} ${cleanName} — Study Guide\n\n` +
    `*Generated from the course's own lecture slides. Each hard idea is explained in plain language first, then precisely. ` +
    `Where a slide carries a figure worth seeing it is embedded inline, and a slide link such as "L1 p18" opens that slide in the source deck at exactly that page.*`;

  progress.stage = "Done";
  report();

  return {
    markdown: [preamble, ...chapters].join("\n\n"),
    sourceNote: `${used.length} deck${used.length === 1 ? "" : "s"}, generated with ${(modelsServed(cfg).length ? modelsServed(cfg) : [cfg.model]).join(" + ")}`,
    problems,
    decks: used,
  };
}

// --- one topic of the automatic guide ----------------------------------------
// A topic is written from one or more lecture decks (newest copy of each),
// plus practice sheets. The body starts at the first "### 1.N" section; the
// chapter heading, the links to quizzes and lecturer notes are added when the
// guide is assembled, so they can change without rewriting anything.
//
// missing counts the parts that could not be written this time — sections
// the model dropped and practice sheets, and apart from them whole decks
// whose outline failed — so the caller can keep what was written and try the
// rest again later. planned is how many sections were attempted. A deck's
// "Key points" recap shares the 1.N numbering, after its sections; it is not
// counted in either, so a failed one never makes a chapter be rewritten.
//
// otherDecks: the module's other deck names, so a link reads "Week1 L2"
// rather than a "Week1" another chapter's deck also goes by.
//
// pageImage: a lecture deck's slide as a PNG, so a model that reads images
// sees the figures it embeds.
export type TopicSource = { name: string; text: string; pageImage?: ((page: number) => Promise<Uint8Array | null>) | null };

export async function generateTopicChapter(opts: {
  cfg: CompatConfig;
  reader?: string | null;
  title: string;
  lectures: TopicSource[];
  practice: TopicSource[];
  otherDecks?: string[];
  onStage?: (stage: string) => void;
}): Promise<{ body: string; problems: string[]; missing: { sections: number; decks: number }; planned: number }> {
  const gen = createGuideGenerator(opts.cfg, opts.reader ?? null);
  const problems: string[] = [];
  const parts: string[] = [];
  const decks = new Map<string, number>();
  const missing = { sections: 0, decks: 0 };
  let n = 0, planned = 0;
  const pagesOf = (text: string) => Number(text.match(/--\s*\d+\s*of\s*(\d+)\s*--/)?.[1] ?? 0);

  for (const deck of opts.lectures) {
    const pageCount = pagesOf(deck.text);
    if (!pageCount || !deck.text.trim()) { problems.push(`${deck.name}: no extractable text`); continue; }
    const cite = citeDeck(deck.name);
    decks.set(cite, pageCount);
    opts.onStage?.(`Planning from ${deck.name}`);
    const outline = await gen.outline(deck.name, deck.text, pageCount).catch(() => null);
    if (!outline) { problems.push(`${deck.name}: outline failed`); missing.decks++; continue; }
    let done = 0;
    const total = outline.sections.length;
    const plan: DeckPlan = {
      deckName: cite, deckText: deck.text, pageCount, pageImage: deck.pageImage ?? null,
      sections: outline.sections.map((s, k) => ({ number: `1.${n + k + 1}`, heading: s.heading, covers: s.covers, slides: s.slides })),
    };
    n += total;
    planned += total;
    const w = await gen.writeDeck(plan, {
      recap: `1.${n + 1}`,
      onSection: () => {
        done++;
        opts.onStage?.(done < total ? `Writing from ${deck.name}: ${done} of ${total} sections` : `Key points from ${deck.name}`);
      },
    });
    if (w.recap) n++;
    const got = deckOutcome(deck.name, w);
    problems.push(...got.problems);
    missing.sections += got.missing;
    // Each section saw only this deck, so a citation to anything else is
    // either this deck misspelt or made up.
    const written = cleanCitations(got.parts.join("\n\n"), new Map([[cite, pageCount]])).markdown;
    problems.push(...validateChapter(written, cite, pageCount).map((p) => `${deck.name}: ${p}`));
    if (written) parts.push(written);
  }
  if (!parts.length) throw new Error(problems[0] ?? "nothing could be written from these slides");

  for (const sheet of opts.practice) {
    const pageCount = pagesOf(sheet.text);
    if (!pageCount || !sheet.text.trim()) continue;
    const cite = citeDeck(sheet.name);
    decks.set(cite, pageCount);
    opts.onStage?.(`Practice: ${sheet.name}`);
    n++;
    planned++;
    try {
      parts.push(cleanCitations(await gen.practice(cite, sheet.text, pageCount, `1.${n} Practice: ${sheet.name}`, opts.title), new Map([[cite, pageCount]])).markdown);
    } catch (e) {
      problems.push(`${sheet.name}: ${String(e).slice(0, 80)}`);
      missing.sections++;
    }
  }
  // Once more over the whole chapter, so two decks that would share a short
  // name — here or elsewhere in the module — are told apart in their links.
  const others = (opts.otherDecks ?? []).map((d) => citeDeck(d));
  return { body: cleanCitations(parts.join("\n\n"), decks, others).markdown, problems, missing, planned };
}
