import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { files, guidePlans, guideTopics } from "../db/schema";
import { baseName } from "../lib/deck-versions";
import { fileKind } from "../lib/file-kind";

// The automatic guide's state, for the guide page. Kept apart from the worker
// so the web server does not load the generator to answer a status check.
// The worker reads and writes the same state through the helpers below.

// --- retries ------------------------------------------------------------------
// A failed chapter or plan is tried again later, waiting longer each time,
// and given up on after MAX_TRIES until its slides change or the student
// asks again. The count rides at the front of the stored error, "[try 3] …",
// so it survives restarts without a column of its own.
export const MAX_TRIES = 5;
const FIRST_WAIT = 30 * 60_000;

export type Failure = { tries: number; on: string | null; message: string };

export function readFailure(error: string | null | undefined): Failure {
  const m = /^\[try (\d+)(?: on ([\w:-]+))?\] ?/.exec(error ?? "");
  return m ? { tries: Number(m[1]), on: m[2] ?? null, message: (error ?? "").slice(m[0].length) } : { tries: 0, on: null, message: error ?? "" };
}

// on: what the attempt was made from, when a change to it should start the
// count again (a plan's slides).
export function writeFailure(tries: number, message: string, on?: string): string {
  return `[try ${tries}${on ? ` on ${on}` : ""}] ${message}`.slice(0, 300);
}

// 30 minutes, then 1, 2 and 4 hours.
export const retryWait = (tries: number) => FIRST_WAIT * 2 ** Math.max(0, tries - 1);

export function retryDue(error: string | null | undefined, errorAt: number | null | undefined, now: number): boolean {
  if (!errorAt) return true;
  const { tries } = readFailure(error);
  return tries < MAX_TRIES && now - errorAt >= retryWait(Math.max(1, tries));
}

// --- what a chapter was built from ------------------------------------------------
// builtHash is the inputHash the body was written from. A chapter where some
// parts could not be written keeps what was, under "<inputHash>~<sections>"
// or "<inputHash>~<sections>+<decks>", so it shows but still counts as work
// to finish. A deck whose outline failed is counted on its own: it is a
// whole lecture missing, not one section.
export type Gap = { sections: number; decks: number };

export const partialHash = (inputHash: string, missing: number | Gap) => {
  const g = typeof missing === "number" ? { sections: missing, decks: 0 } : missing;
  return `${inputHash}~${g.sections}${g.decks ? `+${g.decks}` : ""}`;
};

export type BuildState = "fresh" | "partial" | "stale" | "none";

export function buildState(t: { body: string | null; builtHash: string | null; inputHash: string }): BuildState {
  if (!t.body) return "none";
  if (t.builtHash === t.inputHash) return "fresh";
  if (t.builtHash?.startsWith(`${t.inputHash}~`)) return "partial";
  return "stale";
}

export function missingParts(t: { builtHash: string | null; inputHash: string }): Gap {
  if (!t.builtHash?.startsWith(`${t.inputHash}~`)) return { sections: 0, decks: 0 };
  const [s, d] = t.builtHash.slice(t.inputHash.length + 1).split("+");
  return { sections: Number(s) || 0, decks: Number(d) || 0 };
}

export const missingSections = (t: { builtHash: string | null; inputHash: string }) => missingParts(t).sections;

// Fewer missing decks is better, then fewer missing sections.
export const gapWorse = (a: Gap, b: Gap) => a.decks > b.decks || (a.decks === b.decks && a.sections > b.sections);

// "2 sections", "1 lecture deck", "1 section and 1 lecture deck".
export function gapText(g: Gap): string {
  const part = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  return [g.sections ? part(g.sections, "section") : "", g.decks ? part(g.decks, "lecture deck") : ""].filter(Boolean).join(" and ");
}

// A body written in full from some earlier set of slides.
export const wasComplete = (t: { body: string | null; builtHash: string | null }) => Boolean(t.body && t.builtHash && !t.builtHash.includes("~"));

// --- decks with nothing to read ----------------------------------------------------
// A slide deck that is pages of pictures — a scan, or slides exported as
// images — gives no text, so the guide cannot be written from it. Under this
// many words it counts as one, if that is also only a few words a page: a
// short handout with real text on it is not a scan.
export const MIN_DECK_WORDS = 60;
const SCAN_WORDS_PER_PAGE = 5;

type SigJson = { failed?: boolean; reason?: string; words?: number; pages?: number };

const parseSig = (json: string | null): SigJson | null => {
  if (!json) return null;
  try { return JSON.parse(json) as SigJson; } catch { return null; }
};

export function deckUnreadable(textSigJson: string | null): "scanned" | "unreadable" | null {
  const v = parseSig(textSigJson);
  if (!v) return null;
  if (v.failed) return v.reason === "empty" ? "scanned" : "unreadable";
  const pages = v.pages ?? 0;
  return typeof v.words === "number" && v.words < MIN_DECK_WORDS && pages >= 3 && v.words < pages * SCAN_WORDS_PER_PAGE ? "scanned" : null;
}

// Files a guide can be written from: slides and tutorial sheets that are, or
// convert to, PDF.
export const isGuideFile = (f: { category: string | null; displayName: string }) =>
  (f.category === "slides" || f.category === "tutorial") && ["pdf", "office"].includes(fileKind(f.displayName));

// The decks the guide leaves out because they are only pictures. A scan
// with a readable copy of the same deck beside it (the black-and-white
// printout of a colour deck, an old copy) is not missing from anything.
// The guide's "Not in this guide" line and the status pill both use this.
export function scannedDecks(db: Db, moduleId: number): string[] {
  const rows = db.select({ name: files.displayName, sig: files.textSigJson, category: files.category }).from(files).where(eq(files.moduleId, moduleId)).all()
    .filter((f) => isGuideFile({ category: f.category, displayName: f.name }));
  const readable = new Set(rows.filter((f) => {
    const v = parseSig(f.sig);
    return v && !v.failed && (v.words ?? 0) >= MIN_DECK_WORDS;
  }).map((f) => baseName(f.name)));
  const names = rows.filter((f) => deckUnreadable(f.sig) === "scanned" && !readable.has(baseName(f.name))).map((f) => f.name.replace(/\.[^.]+$/, ""));
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

// Asked for from the guide page: look again now, and optionally write every
// chapter afresh. Chapters that had given up get another go, and decks that
// could not be read — or were scans — are read again.
export function requestGuideRefresh(db: Db, moduleId: number, rewrite: boolean): void {
  db.update(guidePlans).set({ inputHash: null, error: null, errorAt: null }).where(eq(guidePlans.moduleId, moduleId)).run();
  db.update(guideTopics).set({ error: null, errorAt: null, ...(rewrite ? { builtHash: null } : {}) }).where(eq(guideTopics.moduleId, moduleId)).run();
  const unread = db.select({ id: files.id, sig: files.textSigJson }).from(files).where(eq(files.moduleId, moduleId)).all()
    .filter((f) => deckUnreadable(f.sig) !== null).map((f) => f.id);
  if (unread.length) db.update(files).set({ textSigJson: null }).where(inArray(files.id, unread)).run();
}

export function guideStatus(db: Db, moduleId: number) {
  const topics = db.select().from(guideTopics).where(eq(guideTopics.moduleId, moduleId)).all().sort((a, b) => a.ord - b.ord);
  const plan = db.select().from(guidePlans).where(eq(guidePlans.moduleId, moduleId)).get();
  const writing = topics.find((t) => t.stage);
  const state = (t: typeof topics[number]) => buildState(t);
  const gaveUp = (t: typeof topics[number]) => Boolean(t.errorAt) && readFailure(t.error).tries >= MAX_TRIES;
  const planFailure = plan?.error ? readFailure(plan.error) : null;
  const partial = topics.filter((t) => state(t) === "partial" && !gaveUp(t));
  const gap = partial.reduce((g, t) => { const m = missingParts(t); return { sections: g.sections + m.sections, decks: g.decks + m.decks }; }, { sections: 0, decks: 0 });
  // Why, in a line each, for the guide page's menu: a touch screen has no
  // hover to show it on.
  const reason = (m: string) => (m.length > 140 ? `${m.slice(0, 139)}…` : m);
  const problems = [
    ...(planFailure ? [{ title: "Planning the guide", error: reason(planFailure.message) }] : []),
    ...topics.filter((t) => t.error && t.errorAt && state(t) !== "fresh").map((t) => ({ title: t.title, error: reason(readFailure(t.error).message) })),
  ];
  return {
    title: plan?.title ?? null,
    planned: Boolean(plan?.plannedAt),
    planError: planFailure ? planFailure.message : null,
    planGaveUp: Boolean(planFailure && planFailure.tries >= MAX_TRIES),
    total: topics.length,
    // Chapters written from the current slides, including any still missing
    // a section or two.
    ready: topics.filter((t) => state(t) === "fresh" || state(t) === "partial").length,
    queued: topics.filter((t) => state(t) === "stale" || state(t) === "none").length,
    writing: writing ? { title: writing.title, stage: writing.stage } : null,
    // Parts that could not be written yet, across the chapters that have
    // them; they are retried on their own. incompleteText says what they are
    // ("2 sections and 1 lecture deck").
    incomplete: gap.sections + gap.decks,
    incompleteText: gap.sections + gap.decks ? gapText(gap) : null,
    // Chapters with nothing new written yet whose last attempt failed.
    failed: topics.filter((t) => t.error && t.errorAt && (state(t) === "stale" || state(t) === "none") && !gaveUp(t)).map((t) => t.title),
    // Given up on until the slides change or the student asks again.
    stuck: topics.filter((t) => state(t) !== "fresh" && gaveUp(t)).map((t) => ({ title: t.title, error: reason(readFailure(t.error).message) })),
    problems,
    scanned: scannedDecks(db, moduleId),
  };
}
