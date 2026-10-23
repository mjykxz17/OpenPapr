import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { files, guidePlans, guideTopics, items, modules, studyGuides, users } from "../db/schema";
import type { CompatConfig } from "../enrich/openai-compat";
import { planGuide, type PlanInput, type PlanRef } from "../enrich/guide-plan";
import { generateTopicChapter, type TopicSource } from "../enrich/generate-guide";
import { deckSignature, groupVersions, type DeckSig, type VersionGroup } from "../lib/deck-versions";
import { htmlToText } from "../lib/html-text";
import { dayLabel, shortDate } from "../lib/format-date";
import { renumber, splitChapters } from "../lib/guide-chapters";
import { shortModuleName } from "../lib/module-name";
import {
  MAX_TRIES, MIN_DECK_WORDS, buildState, deckUnreadable, gapText, gapWorse, isGuideFile, missingParts, partialHash, readFailure,
  retryDue, scannedDecks, wasComplete, writeFailure,
} from "../server/guide-status";

// The automatic study guide. Nobody presses "generate": as slides land on
// Canvas, each is read once and fingerprinted; copies of one deck (colour and
// black-and-white, partial and full, a corrected re-upload) are recognised and
// only the fullest, newest copy is used; a model sorts the decks into topics
// and names them; and each topic's chapter is written in the background,
// soonest-assessed first, and rewritten only when its slides change. What the
// student opens is always the newest finished version of every chapter.
// Failures are retried with growing waits and given up on after a few tries
// (see guide-status.ts); the guide page says which.

const H = 3_600_000;
const D = 24 * H;
const MIN_LECTURE_SLIDES = 8;
const FINGERPRINTS_PER_PASS = 6;
const REPLAN_EVERY = 6 * H;          // when only quizzes or announcements changed
const UNREADABLE_TRIES = 3;          // a deck that would not download or convert, once a day
const OCR_TRIES = 3;                 // a scan OCR read nothing from, once a day
const CONCURRENT_CHAPTERS = 4;       // chapters written at once, across everyone
const CHAPTERS_PER_PASS = 8;         // then the pass ends, so new slides and plans are looked at again,
                                     // and a pass stays well inside keep-awake's 30-minute cap
const AUTO_PREFIX = "auto";          // study_guides.sourceNote of an automatic guide

export type GuideDeps = {
  db: Db;
  now: () => number;
  cfgFor: (userId: number) => CompatConfig | null;
  readerFor: (userId: number, moduleId: number) => string | null;
  fileText: (userId: number, file: typeof files.$inferSelect, mod: typeof modules.$inferSelect) => Promise<string | null>;
  // One page of a file as a PNG, so a model that reads images sees the
  // figures a chapter embeds. Without it, chapters are written from text.
  pageImage?: (userId: number, file: typeof files.$inferSelect, mod: typeof modules.$inferSelect, page: number) => Promise<Uint8Array | null>;
  // True when fileText can read scanned decks (OCR is installed). A scan read
  // without it is read again once it arrives.
  ocrReady?: () => boolean;
  fetchFn?: typeof fetch;
  log?: (msg: string) => void;
};

type FileRow = typeof files.$inferSelect;
type Mod = typeof modules.$inferSelect;
type Topic = typeof guideTopics.$inferSelect;
type SigRow = FileRow & { sig: DeckSig | null };

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const list = (json: string | null | undefined): number[] => { try { const v = JSON.parse(json ?? "[]"); return Array.isArray(v) ? v.filter(Number.isInteger) : []; } catch { return []; } };
const stem = (name: string) => name.replace(/\.[^.]+$/, "");
const readSig = (json: string | null): DeckSig | null | "failed" => {
  if (!json) return null;
  try { const v = JSON.parse(json); return v?.failed ? "failed" : (v as DeckSig); } catch { return null; }
};

// Files a guide can be written from: slides and tutorial sheets that are, or
// convert to, PDF.
function guideFiles(db: Db, moduleId: number): FileRow[] {
  return db.select().from(files).where(eq(files.moduleId, moduleId)).all().filter(isGuideFile);
}

// --- 1. fingerprints --------------------------------------------------------
// Each file is read once. It is read again when it changes on Canvas (its
// size moves), when it is a scan and OCR has since been installed, and — a
// few times, a day apart — when it would not download or convert, or when
// OCR read nothing from it (OCR keeps no result that lost pages, so a page
// that timed out is read again). A scan without OCR is not retried on a
// timer: the same pages give the same nothing.
type ReadMark = { failed?: boolean; reason?: string; at?: number; tries?: number; size?: number | null; ocr?: boolean; ocrTries?: number };

export function needsRead(f: FileRow, now: number, ocrReady: boolean): boolean {
  if (!f.textSigJson) return true;
  let v: ReadMark;
  try { v = JSON.parse(f.textSigJson) as ReadMark; } catch { return true; }
  if (f.sizeBytes != null && v.size !== undefined && v.size !== f.sizeBytes) return true;
  const unreadable = deckUnreadable(f.textSigJson);
  if (!unreadable) return false;
  // Recorded before reads noted the file's size: once more, to find out why.
  if (v.failed && v.size === undefined) return true;
  if (unreadable === "unreadable") return (v.tries ?? 1) < UNREADABLE_TRIES && now - (v.at ?? 0) > D;
  if (!ocrReady) return false;
  if (!v.ocr) return true;
  return (v.ocrTries ?? 1) < OCR_TRIES && now - (v.at ?? 0) > D;
}

export async function fingerprint(deps: GuideDeps, userId: number, mod: Mod, budget: number): Promise<number> {
  const { db } = deps;
  const now = deps.now();
  const ocr = deps.ocrReady?.() ?? false;
  const todo = guideFiles(db, mod.id).filter((f) => needsRead(f, now, ocr))
    .sort((a, b) => b.discoveredAt - a.discoveredAt).slice(0, budget);
  for (const f of todo) {
    let text: string | null = null;
    try { text = await deps.fileText(userId, f, mod); } catch { text = null; }
    let prior: ReadMark = {};
    try { prior = JSON.parse(f.textSigJson ?? "{}") as ReadMark; } catch { /* first read */ }
    // Reads with OCR are counted, per copy of the file, so a scan it cannot
    // read is tried a few times and then left.
    const sameFile = prior.size === (f.sizeBytes ?? null);
    const mark = { size: f.sizeBytes ?? null, ocr, ...(ocr ? { at: now, ocrTries: sameFile && prior.ocr ? (prior.ocrTries ?? 1) + 1 : 1 } : {}) };
    const sig = text === null
      ? { failed: true, reason: "unreadable", at: now, tries: prior.reason === "unreadable" ? (prior.tries ?? 1) + 1 : 1, ...mark }
      : !text.trim() ? { failed: true, reason: "empty", at: now, ...mark }
      : { ...deckSignature(text), ...mark };
    db.update(files).set({ textSigJson: JSON.stringify(sig) }).where(eq(files.id, f.id)).run();
  }
  return todo.length;
}

// --- 2. which copy of each deck -------------------------------------------------
export function canonicalSets(db: Db, moduleId: number): { ready: boolean; lectures: VersionGroup<SigRow>[]; practice: VersionGroup<SigRow>[] } {
  const rows = guideFiles(db, moduleId);
  const ready = rows.every((f) => readSig(f.textSigJson) !== null);
  const usable = (cat: string, min: number) => rows
    .map((f) => ({ ...f, sig: readSig(f.textSigJson) }))
    .filter((f): f is SigRow & { sig: DeckSig } => f.category === cat && f.sig !== null && f.sig !== "failed" && f.sig.pages >= min && f.sig.words >= MIN_DECK_WORDS);
  const natural = (a: VersionGroup<SigRow>, b: VersionGroup<SigRow>) => a.canonical.displayName.localeCompare(b.canonical.displayName, undefined, { numeric: true });
  return {
    ready,
    lectures: groupVersions(usable("slides", MIN_LECTURE_SLIDES)).sort(natural),
    practice: groupVersions(usable("tutorial", 1)).sort(natural),
  };
}

// What a chapter is written from: which decks, and what they say. In id
// order, so the planner listing the same decks differently changes nothing.
const topicInputHash = (lectures: SigRow[], practice: SigRow[]) => {
  const ids = (rows: SigRow[]) => [...rows].sort((a, b) => a.id - b.id).map((f) => [f.id, f.sig?.hash]);
  return hash({ l: ids(lectures), p: ids(practice) });
};

// --- 3. topics -------------------------------------------------------------------
function planInput(db: Db, userId: number, mod: Mod, sets: ReturnType<typeof canonicalSets>, now: number) {
  const L = new Map<string, SigRow>(), P = new Map<string, SigRow>(), A = new Map<string, number>(), N = new Map<string, number>();
  const lectures: PlanRef[] = sets.lectures.map((g, i) => {
    L.set(`L${i + 1}`, g.canonical);
    return { ref: `L${i + 1}`, line: `${g.canonical.displayName} (${g.canonical.sig?.pages ?? "?"} slides): ${g.canonical.sig?.head.slice(0, 240) ?? ""}` };
  });
  const practice: PlanRef[] = sets.practice.map((g, i) => {
    P.set(`P${i + 1}`, g.canonical);
    return { ref: `P${i + 1}`, line: `${g.canonical.displayName}: ${g.canonical.sig?.head.slice(0, 160) ?? ""}` };
  });
  const rows = db.select().from(items).where(and(eq(items.userId, userId), eq(items.moduleId, mod.id))).all().filter((i) => !i.dismissed);
  const assessments: PlanRef[] = rows
    .filter((i) => (i.type === "assignment" || i.type === "deadline") && (i.dueAt === null || (i.dueAt > now - 30 * D && i.dueAt < now + 150 * D)))
    .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)).slice(0, 30)
    .map((i, k) => { A.set(`A${k + 1}`, i.id); return { ref: `A${k + 1}`, line: `${i.title} — ${i.dueAt ? dayLabel(i.dueAt) : "no date"}` }; });
  const notes: PlanRef[] = rows
    .filter((i) => (i.type === "announcement" || i.type === "staff_reply") && (i.sourceCreatedAt ?? i.firstSeenAt) > now - 75 * D)
    .sort((a, b) => (b.sourceCreatedAt ?? b.firstSeenAt) - (a.sourceCreatedAt ?? a.firstSeenAt)).slice(0, 25)
    .map((i, k) => { N.set(`N${k + 1}`, i.id); return { ref: `N${k + 1}`, line: `${i.title}: ${htmlToText(i.body).replace(/\s+/g, " ").slice(0, 180)}` }; });
  const existing = db.select().from(guideTopics).where(eq(guideTopics.moduleId, mod.id)).all().sort((a, b) => a.ord - b.ord);
  const refOf = new Map([...L].map(([r, f]) => [f.id, r]));
  const input: PlanInput = {
    module: `${mod.code} ${shortModuleName(mod.code, mod.name)}`,
    lectures, practice, assessments, notes,
    existing: existing.map((t) => ({ key: t.key, title: t.title, lectures: list(t.lectureIdsJson).map((id) => refOf.get(id) ?? "?").filter((r) => r !== "?") })),
  };
  return { input, L, P, A, N };
}

export async function maybePlan(deps: GuideDeps, userId: number, mod: Mod, cfg: CompatConfig): Promise<boolean> {
  const { db } = deps;
  const now = deps.now();
  const sets = canonicalSets(db, mod.id);
  if (!sets.ready || sets.lectures.length === 0) return false;
  const { input, L, P, A, N } = planInput(db, userId, mod, sets, now);
  // Which copy of each deck, and exactly what it says.
  const lectureHash = hash([[...L.values()].map((f) => [f.id, f.sig?.hash]), [...P.values()].map((f) => [f.id, f.sig?.hash])]);
  const fullHash = `${lectureHash}:${hash([input.assessments, input.notes])}`;
  const prior = db.select().from(guidePlans).where(eq(guidePlans.moduleId, mod.id)).get();
  if (prior?.inputHash === fullHash) return false;
  const slidesMoved = !prior?.inputHash || !prior.inputHash.startsWith(`${lectureHash}:`);
  if (!slidesMoved && prior?.plannedAt && now - prior.plannedAt < REPLAN_EVERY) return false;
  // A plan that keeps failing on these same slides waits longer each time,
  // then stops until they change or the student asks again.
  const failure = readFailure(prior?.error);
  if (prior?.errorAt && failure.on === lectureHash && !retryDue(prior.error, prior.errorAt, now)) return false;

  let plan;
  try {
    plan = await planGuide(cfg, input, (ref) => stem(L.get(ref)!.displayName), deps.fetchFn);
  } catch (err) {
    const error = writeFailure(failure.on === lectureHash ? failure.tries + 1 : 1, String(err instanceof Error ? err.message : err), lectureHash);
    db.insert(guidePlans).values({ moduleId: mod.id, error, errorAt: now })
      .onConflictDoUpdate({ target: guidePlans.moduleId, set: { error, errorAt: now } }).run();
    return false;
  }

  const first = !prior?.plannedAt;
  const old = db.select().from(guideTopics).where(eq(guideTopics.moduleId, mod.id)).all();
  const sameSet = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));
  const ids = (refs: string[], M: Map<string, number>) => refs.map((r) => M.get(r)!);
  const deckIds = (refs: string[]) => refs.map((r) => L.get(r)!.id);

  // Only the quizzes or announcements changed: the decks are what they were,
  // so the chapters stay exactly as grouped and only their links move. A
  // planner that groups the same decks a little differently this time must
  // not cost a rewrite.
  if (!slidesMoved && !first && old.length) {
    db.transaction((tx) => {
      for (const o of old) {
        const mine = list(o.lectureIdsJson);
        const best = plan.topics
          .map((t) => ({ t, overlap: deckIds(t.lectures).filter((id) => mine.includes(id)).length }))
          .sort((a, b) => b.overlap - a.overlap)[0];
        const t = best && best.overlap > 0 ? best.t : null;
        tx.update(guideTopics).set({
          itemIdsJson: JSON.stringify(t ? ids(t.assessments, A) : []),
          noteIdsJson: JSON.stringify(t ? ids(t.notes, N) : []),
        }).where(eq(guideTopics.id, o.id)).run();
      }
      tx.update(guidePlans).set({ inputHash: fullHash, plannedAt: now, error: null, errorAt: null }).where(eq(guidePlans.moduleId, mod.id)).run();
    });
    deps.log?.(`guide links for ${mod.code} updated`);
    return true;
  }

  // Each planned topic takes over an old chapter: first one with exactly
  // these decks (whatever the planner calls it now), then one under the same
  // key. Matching decks first means a planner that swaps two keys does not
  // rewrite both chapters.
  const lecturesOf = plan.topics.map((t) => t.lectures.map((r) => L.get(r)!));
  const match: (Topic | undefined)[] = plan.topics.map(() => undefined);
  const taken = new Set<number>();
  plan.topics.forEach((_, i) => {
    const m = old.find((o) => !taken.has(o.id) && sameSet(list(o.lectureIdsJson), lecturesOf[i].map((f) => f.id)));
    if (m) { match[i] = m; taken.add(m.id); }
  });
  plan.topics.forEach((t, i) => {
    if (match[i]) return;
    const m = old.find((o) => o.key === t.key && !taken.has(o.id));
    if (m) { match[i] = m; taken.add(m.id); }
  });
  // A practice sheet stays with the chapter it was in while that chapter's
  // lectures are unchanged; only sheets new to the guide go where the
  // planner puts them.
  const sticky = new Map<number, number>();
  plan.topics.forEach((_, i) => {
    const m = match[i];
    if (!m || !sameSet(list(m.lectureIdsJson), lecturesOf[i].map((f) => f.id))) return;
    for (const id of list(m.practiceIdsJson)) if ([...P.values()].some((f) => f.id === id)) sticky.set(id, i);
  });
  const practiceOf = (i: number) => {
    const planned = plan.topics[i].practice.map((r) => P.get(r)!).filter((f) => !sticky.has(f.id) || sticky.get(f.id) === i);
    const kept = [...P.values()].filter((f) => sticky.get(f.id) === i && !planned.includes(f));
    return [...planned, ...kept];
  };

  const legacy = first ? legacyChapters(db, mod.id) : new Map<string, string>();
  db.transaction((tx) => {
    const gone = old.filter((o) => !taken.has(o.id)).map((o) => o.id);
    if (gone.length) tx.delete(guideTopics).where(inArray(guideTopics.id, gone)).run();
    // Kept chapters may trade keys; park them first so no two ever share one.
    for (const id of taken) tx.update(guideTopics).set({ key: `~${id}` }).where(eq(guideTopics.id, id)).run();
    plan.topics.forEach((t, ord) => {
      const lectures = lecturesOf[ord];
      const practice = practiceOf(ord);
      const values = {
        title: t.title, ord,
        lectureIdsJson: JSON.stringify(lectures.map((f) => f.id)),
        practiceIdsJson: JSON.stringify(practice.map((f) => f.id)),
        itemIdsJson: JSON.stringify(ids(t.assessments, A)),
        noteIdsJson: JSON.stringify(ids(t.notes, N)),
        inputHash: topicInputHash(lectures, practice),
      };
      // The same chapter: keep what was written, so a rename costs nothing.
      // New decks under it mean a rewrite, and a fresh count of tries.
      const m = match[ord];
      if (m) {
        const moved = m.inputHash !== values.inputHash;
        tx.update(guideTopics).set({ ...values, key: t.key, ...(moved ? { error: null, errorAt: null } : {}) }).where(eq(guideTopics.id, m.id)).run();
        return;
      }
      // First plan for a module that already had a hand-made guide: a
      // one-deck topic takes that deck's chapter rather than being rewritten.
      const seeded = lectures.length === 1 ? legacy.get(stem(lectures[0].displayName).toLowerCase()) : undefined;
      tx.insert(guideTopics).values({
        moduleId: mod.id, key: t.key, ...values,
        ...(seeded ? { body: seeded, builtHash: values.inputHash, builtAt: now } : {}),
      }).run();
    });
    tx.insert(guidePlans).values({ moduleId: mod.id, title: plan.title, inputHash: fullHash, plannedAt: now, error: null, errorAt: null })
      .onConflictDoUpdate({ target: guidePlans.moduleId, set: { title: plan.title, inputHash: fullHash, plannedAt: now, error: null, errorAt: null } }).run();
  });
  deps.log?.(`guide plan for ${mod.code}: ${plan.topics.length} topics`);
  return true;
}

// Chapters of a guide written before guides were automatic, by deck, with
// their "## N. Title" line taken off.
function legacyChapters(db: Db, moduleId: number): Map<string, string> {
  const g = db.select().from(studyGuides).where(eq(studyGuides.moduleId, moduleId)).get();
  const out = new Map<string, string>();
  if (!g || g.sourceNote?.startsWith(AUTO_PREFIX)) return out;
  for (const c of splitChapters(g.markdown).chapters) {
    if (!c.deck) continue;
    const body = c.markdown.split("\n").slice(1).join("\n").trim();
    if (body) out.set(c.deck.toLowerCase(), body);
  }
  return out;
}

// --- 4. the guide the student reads ----------------------------------------------
export function assembleGuide(db: Db, mod: Mod, now: number): boolean {
  const topics = db.select().from(guideTopics).where(eq(guideTopics.moduleId, mod.id)).all().sort((a, b) => a.ord - b.ord);
  if (!topics.length) return false;
  const plan = db.select().from(guidePlans).where(eq(guidePlans.moduleId, mod.id)).get();
  const ids = [...new Set(topics.flatMap((t) => [...list(t.itemIdsJson), ...list(t.noteIdsJson)]))];
  const byId = new Map(ids.length ? db.select().from(items).where(inArray(items.id, ids)).all().map((i) => [i.id, i]) : []);
  const fileIds = [...new Set(topics.flatMap((t) => list(t.lectureIdsJson)))];
  const fileName = new Map(fileIds.length ? db.select({ id: files.id, n: files.displayName }).from(files).where(inArray(files.id, fileIds)).all().map((f) => [f.id, f.n]) : []);

  const chapters = topics.map((t) => {
    const lines = [`## 1. ${t.title}`];
    const counts = list(t.itemIdsJson).map((id) => byId.get(id)).filter(Boolean).map((i) => {
      const when = i!.dueAt ? dayLabel(i!.dueAt) : "date not set";
      const state = i!.submitted || i!.canvasDone ? " (done)" : i!.dueAt && i!.dueAt < now ? " (past)" : "";
      return `${i!.title} — ${when}${state}`;
    });
    if (counts.length) lines.push(`> **Counts toward:** ${counts.join(" · ")}`);
    for (const id of list(t.noteIdsJson).slice(0, 2)) {
      const n = byId.get(id);
      if (!n) continue;
      const said = htmlToText(n.body).replace(/\s+/g, " ").trim();
      lines.push(`> **${n.type === "staff_reply" ? "Staff reply" : "Lecturer"}, ${shortDate(n.sourceCreatedAt ?? n.firstSeenAt)}:** ${n.title}${said ? ` — "${said.slice(0, 220)}${said.length > 220 ? "…" : ""}"` : ""}`);
    }
    const decks = list(t.lectureIdsJson).map((id) => fileName.get(id)).filter(Boolean).map((n) => stem(n!));
    const built = buildState(t);
    const gaveUp = Boolean(t.errorAt) && readFailure(t.error).tries >= MAX_TRIES;
    const again = "Use “Check for new slides now” on the guide page to try again.";
    if (built === "stale") lines.push(`> *Newer slides are out for this topic. This chapter is being updated and will change here on its own.*`);
    if (built === "partial") {
      const gap = missingParts(t);
      const one = gap.sections + gap.decks === 1;
      const what = one ? (gap.sections ? "One section" : "One lecture deck") : gapText(gap);
      lines.push(`> *${what} of this chapter couldn't be written yet. ${gaveUp ? again : `${one ? "It is" : "They are"} being retried and will appear here on their own.`}*`);
    }
    if (!t.body) lines.push(`*This chapter is being written from ${decks.join(", ") || "the slides"}. ${gaveUp ? `Writing it failed several times. ${again}` : `It will appear here on its own${t.error ? " (the last attempt failed and will be retried)" : ""}.`}*`);
    // The body goes in exactly as stored, blank lines in code and all, so a
    // chapter's quiz key (chapterHash) is the same from either.
    const head = lines.join("\n\n").replace(/\n{3,}/g, "\n\n");
    return { deck: null, markdown: t.body ? `${head}\n\n${t.body}` : head };
  });

  const ready = topics.filter((t) => t.body).length;
  const latest = Math.max(0, ...topics.map((t) => t.builtAt ?? 0));
  const title = plan?.title || `${shortModuleName(mod.code, mod.name)} study guide`;
  // Decks that are only pictures are said to be missing, not silently left out.
  const scans = scannedDecks(db, mod.id);
  const scanNote = scans.length ? `\n\n*Not in this guide: ${scans.join(", ")} — ${scans.length === 1 ? "this deck is" : "these decks are"} scanned images, with no text to read.*` : "";
  const preamble = `# ${title}\n\n*${mod.code}. Written from the newest copy of each lecture deck and kept up to date on its own: when slides change on Canvas, only the chapters they touch are rewritten. ${ready} of ${topics.length} chapters ready${latest ? `, last updated ${shortDate(latest)}` : ""}.*${scanNote}`;
  const markdown = [preamble, ...renumber(chapters).map((c) => c.markdown)].join("\n\n");

  const current = db.select().from(studyGuides).where(eq(studyGuides.moduleId, mod.id)).get();
  // A hand-made guide stays until the automatic one has something of its own.
  if (current && !current.sourceNote?.startsWith(AUTO_PREFIX) && ready === 0) return false;
  if (current?.markdown === markdown) return false;
  const note = `${AUTO_PREFIX} · ${ready} of ${topics.length} chapters`;
  db.insert(studyGuides).values({ moduleId: mod.id, markdown, sourceNote: note, generatedAt: latest || now })
    .onConflictDoUpdate({ target: studyGuides.moduleId, set: { markdown, sourceNote: note, generatedAt: latest || now } }).run();
  return true;
}

// --- 5. writing chapters ------------------------------------------------------------
// The next chapters to write anywhere: ones whose slides have moved past what
// they were written from (or that are missing sections), not waiting out a
// retry, for a student with a model. Students take turns — whoever was
// written for longest ago goes first — so one student's sixty decks do not
// hold up everyone else. Within a student, topics with the soonest quiz or
// assignment go first, then the newest decks.
export function nextTopics(db: Db, now: number, hasModel: (userId: number) => boolean, limit = 1): { topic: Topic; mod: Mod }[] {
  const mods = new Map(db.select().from(modules).where(and(eq(modules.active, true), eq(modules.hidden, false))).all().map((m) => [m.id, m]));
  const all = db.select().from(guideTopics).all().filter((t) => mods.has(t.moduleId));
  const due = all.filter((t) => t.builtHash !== t.inputHash && retryDue(t.error, t.errorAt, now) && hasModel(mods.get(t.moduleId)!.userId));
  if (!due.length) return [];
  const itemIds = [...new Set(due.flatMap((t) => list(t.itemIdsJson)))];
  const dueAt = new Map(itemIds.length ? db.select({ id: items.id, d: items.dueAt, s: items.submitted }).from(items).where(inArray(items.id, itemIds)).all().map((i) => [i.id, i.s ? null : i.d]) : []);
  const fileIds = [...new Set(due.flatMap((t) => list(t.lectureIdsJson)))];
  const seen = new Map(fileIds.length ? db.select({ id: files.id, at: files.discoveredAt }).from(files).where(inArray(files.id, fileIds)).all().map((f) => [f.id, f.at]) : []);
  const soonest = (t: Topic) => Math.min(Infinity, ...list(t.itemIdsJson).map((id) => dueAt.get(id)).filter((d): d is number => d != null && d > now));
  const newest = (t: Topic) => Math.max(0, ...list(t.lectureIdsJson).map((id) => seen.get(id) ?? 0));
  due.sort((a, b) => soonest(a) - soonest(b) || newest(b) - newest(a) || a.ord - b.ord);

  const owner = (t: Topic) => mods.get(t.moduleId)!.userId;
  const lastServed = new Map<number, number>();
  for (const t of all) lastServed.set(owner(t), Math.max(lastServed.get(owner(t)) ?? 0, t.builtAt ?? 0, t.errorAt ?? 0));
  const queues = new Map<number, Topic[]>();
  for (const t of due) queues.set(owner(t), [...(queues.get(owner(t)) ?? []), t]);
  // Map order is each student's most urgent topic; the stable sort keeps it
  // between students served equally recently.
  const turn = [...queues.keys()].sort((a, b) => (lastServed.get(a) ?? 0) - (lastServed.get(b) ?? 0));
  const out: { topic: Topic; mod: Mod }[] = [];
  for (let round = 0; out.length < limit && turn.some((u) => queues.get(u)!.length > round); round++) {
    for (const u of turn) {
      const t = queues.get(u)![round];
      if (t && out.length < limit) out.push({ topic: t, mod: mods.get(t.moduleId)! });
    }
  }
  return out;
}

export async function writeTopic(deps: GuideDeps, topic: Topic, mod: Mod): Promise<boolean> {
  const { db } = deps;
  const cfg = deps.cfgFor(mod.userId);
  if (!cfg) return false;
  const target = topic.inputHash;
  const tries = readFailure(topic.error).tries + 1;
  const setStage = (stage: string | null) => db.update(guideTopics).set({ stage }).where(eq(guideTopics.id, topic.id)).run();
  setStage("Reading the slides");
  try {
    // Lecture decks come with their slides as images, for the figures.
    const load = async (ids: number[], images: boolean) => {
      const rows = ids.length ? db.select().from(files).where(inArray(files.id, ids)).all() : [];
      const out: TopicSource[] = [];
      for (const id of ids) {
        const f = rows.find((r) => r.id === id);
        if (!f) continue;
        const text = await deps.fileText(mod.userId, f, mod);
        const pageImage = images && deps.pageImage ? (page: number) => deps.pageImage!(mod.userId, f, mod, page) : null;
        if (text?.trim()) out.push({ name: stem(f.displayName), text, pageImage });
      }
      return out;
    };
    const lectures = await load(list(topic.lectureIdsJson), true);
    const practice = await load(list(topic.practiceIdsJson), false);
    // The module's other decks, so a short link name is never shared with one.
    const mine = new Set([...list(topic.lectureIdsJson), ...list(topic.practiceIdsJson)]);
    const otherDecks = guideFiles(db, mod.id).filter((f) => !mine.has(f.id)).map((f) => stem(f.displayName));
    const { body, problems, missing, planned } = await generateTopicChapter({
      cfg, reader: deps.readerFor(mod.userId, mod.id), title: topic.title, lectures, practice, otherDecks,
      onStage: (s) => setStage(s),
    });
    const now = deps.now();
    if (missing.sections + missing.decks > 0) {
      // Some parts could not be written. What was written shows now, and the
      // chapter stays on the list to finish. The version already showing is
      // kept instead when it is better: a partial one from these same slides
      // that is missing less, or a complete one from older slides when this
      // attempt lost a whole deck or half its sections.
      const current = db.select().from(guideTopics).where(eq(guideTopics.id, topic.id)).get() ?? topic;
      const keep = current.inputHash === target && (
        (buildState(current) === "partial" && gapWorse(missing, missingParts(current))) ||
        (buildState(current) === "stale" && wasComplete(current) && (missing.decks > 0 || missing.sections * 2 >= planned)));
      const error = writeFailure(tries, `${gapText(missing)} couldn't be written: ${problems.slice(0, 2).join("; ")}`);
      db.update(guideTopics).set({ ...(keep ? {} : { body, builtHash: partialHash(target, missing), builtAt: now }), stage: null, error, errorAt: now })
        .where(eq(guideTopics.id, topic.id)).run();
      deps.log?.(`guide chapter partly written: ${mod.code} "${topic.title}" (${gapText(missing)} missing, try ${tries}${keep ? ", kept the version showing" : ""})`);
    } else {
      db.update(guideTopics).set({ body, builtHash: target, builtAt: now, stage: null, error: problems.length ? problems.slice(0, 3).join("; ").slice(0, 300) : null, errorAt: null })
        .where(eq(guideTopics.id, topic.id)).run();
      deps.log?.(`guide chapter written: ${mod.code} "${topic.title}" (${body.length} chars)`);
    }
  } catch (err) {
    db.update(guideTopics).set({ stage: null, error: writeFailure(tries, String(err instanceof Error ? err.message : err)), errorAt: deps.now() })
      .where(eq(guideTopics.id, topic.id)).run();
    deps.log?.(`guide chapter failed: ${mod.code} "${topic.title}" (try ${tries}): ${String(err).slice(0, 120)}`);
  }
  assembleGuide(db, mod, deps.now());
  return true;
}

// --- the loop ---------------------------------------------------------------------
// Preparation (fingerprints, plans, headers) is cheap and done for every
// module each pass; then several chapters are written side by side, for
// different students when more than one is waiting. Writing takes minutes,
// and every call still queues behind its provider's rate limit.
export async function runAutoGuides(deps: GuideDeps): Promise<void> {
  const { db } = deps;
  // Chapters are only ever written from here: a stage left behind belongs
  // to a write the worker did not live to finish.
  db.update(guideTopics).set({ stage: null }).run();
  let budget = FINGERPRINTS_PER_PASS;
  const people = db.select().from(users).all().filter((u) => u.canvasTokenEnc && deps.cfgFor(u.id));
  for (const u of people) {
    const cfg = deps.cfgFor(u.id)!;
    for (const mod of db.select().from(modules).where(and(eq(modules.userId, u.id), eq(modules.active, true), eq(modules.hidden, false))).all()) {
      if (budget > 0) budget -= await fingerprint(deps, u.id, mod, Math.min(budget, 3));
      await maybePlan(deps, u.id, mod, cfg);
      assembleGuide(db, mod, deps.now());
    }
  }
  const next = nextTopics(db, deps.now(), (userId) => Boolean(deps.cfgFor(userId)), CHAPTERS_PER_PASS);
  await inSlots(next, CONCURRENT_CHAPTERS, (n) => writeTopic(deps, n.topic, n.mod));
}

// Runs fn over items, at most `slots` at once. A slot takes the next item as
// soon as it is free, so one long chapter does not hold up the others the
// way a batch waiting for its slowest would.
export async function inSlots<T>(items: T[], slots: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(slots, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  }));
}

export { guideStatus, requestGuideRefresh } from "../server/guide-status";
