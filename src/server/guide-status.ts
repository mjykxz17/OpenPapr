import { and, eq, like } from "drizzle-orm";
import type { Db } from "../db/client";
import { files, guidePlans, guideTopics } from "../db/schema";

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
// sections could not be written keeps what was, under "<inputHash>~<missing>",
// so it shows but still counts as work to finish.
export const partialHash = (inputHash: string, missing: number) => `${inputHash}~${missing}`;

export type BuildState = "fresh" | "partial" | "stale" | "none";

export function buildState(t: { body: string | null; builtHash: string | null; inputHash: string }): BuildState {
  if (!t.body) return "none";
  if (t.builtHash === t.inputHash) return "fresh";
  if (t.builtHash?.startsWith(`${t.inputHash}~`)) return "partial";
  return "stale";
}

export const missingSections = (t: { builtHash: string | null; inputHash: string }) =>
  t.builtHash?.startsWith(`${t.inputHash}~`) ? Number(t.builtHash.slice(t.inputHash.length + 1)) || 0 : 0;

// --- decks with nothing to read ----------------------------------------------------
// A slide deck that is pages of pictures — a scan, or slides exported as
// images — gives no text, so the guide cannot be written from it. Under this
// many words it counts as one.
export const MIN_DECK_WORDS = 60;

type SigJson = { failed?: boolean; reason?: string; words?: number; pages?: number };

export function deckUnreadable(textSigJson: string | null): "scanned" | "unreadable" | null {
  if (!textSigJson) return null;
  let v: SigJson;
  try { v = JSON.parse(textSigJson) as SigJson; } catch { return null; }
  if (v?.failed) return v.reason === "empty" ? "scanned" : "unreadable";
  return typeof v?.words === "number" && v.words < MIN_DECK_WORDS && (v.pages ?? 0) >= 3 ? "scanned" : null;
}

// Asked for from the guide page: look again now, and optionally write every
// chapter afresh. Chapters that had given up get another go, and decks that
// could not be read are read again.
export function requestGuideRefresh(db: Db, moduleId: number, rewrite: boolean): void {
  db.update(guidePlans).set({ inputHash: null, error: null, errorAt: null }).where(eq(guidePlans.moduleId, moduleId)).run();
  db.update(guideTopics).set({ error: null, errorAt: null, ...(rewrite ? { builtHash: null } : {}) }).where(eq(guideTopics.moduleId, moduleId)).run();
  db.update(files).set({ textSigJson: null }).where(and(eq(files.moduleId, moduleId), like(files.textSigJson, `{"failed":true%`))).run();
}

export function guideStatus(db: Db, moduleId: number) {
  const topics = db.select().from(guideTopics).where(eq(guideTopics.moduleId, moduleId)).all().sort((a, b) => a.ord - b.ord);
  const plan = db.select().from(guidePlans).where(eq(guidePlans.moduleId, moduleId)).get();
  const writing = topics.find((t) => t.stage);
  const state = (t: typeof topics[number]) => buildState(t);
  const gaveUp = (t: typeof topics[number]) => Boolean(t.errorAt) && readFailure(t.error).tries >= MAX_TRIES;
  const scanned = db.select({ name: files.displayName, sig: files.textSigJson, category: files.category }).from(files).where(eq(files.moduleId, moduleId)).all()
    .filter((f) => (f.category === "slides" || f.category === "tutorial") && deckUnreadable(f.sig) === "scanned")
    .map((f) => f.name.replace(/\.[^.]+$/, ""));
  const planFailure = plan?.error ? readFailure(plan.error) : null;
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
    // Sections that could not be written yet, across the chapters that have
    // them; they are retried on their own.
    incomplete: topics.filter((t) => state(t) === "partial" && !gaveUp(t)).reduce((n, t) => n + missingSections(t), 0),
    // Chapters with nothing new written yet whose last attempt failed.
    failed: topics.filter((t) => t.error && t.errorAt && (state(t) === "stale" || state(t) === "none") && !gaveUp(t)).map((t) => t.title),
    // Given up on until the slides change or the student asks again.
    stuck: topics.filter((t) => state(t) !== "fresh" && gaveUp(t)).map((t) => ({ title: t.title, error: readFailure(t.error).message })),
    scanned,
  };
}
