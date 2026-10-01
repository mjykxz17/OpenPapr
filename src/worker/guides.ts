import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { files, guidePlans, guideTopics, items, modules, studyGuides, users } from "../db/schema";
import type { CompatConfig } from "../enrich/openai-compat";
import { planGuide, type PlanInput, type PlanRef } from "../enrich/guide-plan";
import { generateTopicChapter } from "../enrich/generate-guide";
import { deckSignature, groupVersions, type DeckSig, type VersionGroup } from "../lib/deck-versions";
import { fileKind } from "../lib/file-kind";
import { htmlToText } from "../lib/html-text";
import { dayLabel, shortDate } from "../lib/format-date";
import { renumber, splitChapters } from "../lib/guide-chapters";
import { shortModuleName } from "../lib/module-name";

// The automatic study guide. Nobody presses "generate": as slides land on
// Canvas, each is read once and fingerprinted; copies of one deck (colour and
// black-and-white, partial and full, a corrected re-upload) are recognised and
// only the fullest, newest copy is used; a model sorts the decks into topics
// and names them; and each topic's chapter is written in the background,
// soonest-assessed first, and rewritten only when its slides change. What the
// student opens is always the newest finished version of every chapter.

const H = 3_600_000;
const D = 24 * H;
const MIN_LECTURE_SLIDES = 8;
const FINGERPRINTS_PER_PASS = 6;
const REPLAN_EVERY = 6 * H;          // when only quizzes or announcements changed
const ERROR_BACKOFF = 2 * H;
const AUTO_PREFIX = "auto";          // study_guides.sourceNote of an automatic guide

export type GuideDeps = {
  db: Db;
  now: () => number;
  cfgFor: (userId: number) => CompatConfig | null;
  readerFor: (userId: number, moduleId: number) => string | null;
  fileText: (userId: number, file: typeof files.$inferSelect, mod: typeof modules.$inferSelect) => Promise<string | null>;
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
  return db.select().from(files).where(eq(files.moduleId, moduleId)).all()
    .filter((f) => (f.category === "slides" || f.category === "tutorial") && ["pdf", "office"].includes(fileKind(f.displayName)));
}

// --- 1. fingerprints --------------------------------------------------------
export async function fingerprint(deps: GuideDeps, userId: number, mod: Mod, budget: number): Promise<number> {
  const { db } = deps;
  const now = deps.now();
  const todo = guideFiles(db, mod.id).filter((f) => {
    const s = readSig(f.textSigJson);
    if (s === null) return true;
    if (s === "failed") { try { return now - (JSON.parse(f.textSigJson!).at ?? 0) > D; } catch { return true; } }
    return false;
  }).sort((a, b) => b.discoveredAt - a.discoveredAt).slice(0, budget);
  for (const f of todo) {
    let text: string | null = null;
    try { text = await deps.fileText(userId, f, mod); } catch { text = null; }
    const sig = text && text.trim() ? deckSignature(text) : null;
    db.update(files).set({ textSigJson: JSON.stringify(sig ?? { failed: true, at: now }) }).where(eq(files.id, f.id)).run();
  }
  return todo.length;
}

// --- 2. which copy of each deck -------------------------------------------------
export function canonicalSets(db: Db, moduleId: number): { ready: boolean; lectures: VersionGroup<SigRow>[]; practice: VersionGroup<SigRow>[] } {
  const rows = guideFiles(db, moduleId);
  const ready = rows.every((f) => readSig(f.textSigJson) !== null);
  const usable = (cat: string, min: number) => rows
    .map((f) => ({ ...f, sig: readSig(f.textSigJson) }))
    .filter((f): f is SigRow & { sig: DeckSig } => f.category === cat && f.sig !== null && f.sig !== "failed" && f.sig.pages >= min && f.sig.words >= 60);
  const natural = (a: VersionGroup<SigRow>, b: VersionGroup<SigRow>) => a.canonical.displayName.localeCompare(b.canonical.displayName, undefined, { numeric: true });
  return {
    ready,
    lectures: groupVersions(usable("slides", MIN_LECTURE_SLIDES)).sort(natural),
    practice: groupVersions(usable("tutorial", 1)).sort(natural),
  };
}

const topicInputHash = (lectures: SigRow[], practice: SigRow[]) =>
  hash({ l: lectures.map((f) => [f.id, f.sig?.hash]), p: practice.map((f) => [f.id, f.sig?.hash]) });

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
  if (prior?.errorAt && now - prior.errorAt < ERROR_BACKOFF) return false;

  let plan;
  try {
    plan = await planGuide(cfg, input, (ref) => stem(L.get(ref)!.displayName), deps.fetchFn);
  } catch (err) {
    db.insert(guidePlans).values({ moduleId: mod.id, error: String(err).slice(0, 300), errorAt: now })
      .onConflictDoUpdate({ target: guidePlans.moduleId, set: { error: String(err).slice(0, 300), errorAt: now } }).run();
    return false;
  }

  const first = !prior?.plannedAt;
  const old = db.select().from(guideTopics).where(eq(guideTopics.moduleId, mod.id)).all();
  const byKey = new Map(old.map((t) => [t.key, t]));
  const sameSet = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));
  const legacy = first ? legacyChapters(db, mod.id) : new Map<string, string>();
  const kept = new Set<number>();

  db.transaction((tx) => {
    plan.topics.forEach((t, ord) => {
      const lectures = t.lectures.map((r) => L.get(r)!);
      const practice = t.practice.map((r) => P.get(r)!);
      const values = {
        title: t.title, ord,
        lectureIdsJson: JSON.stringify(lectures.map((f) => f.id)),
        practiceIdsJson: JSON.stringify(practice.map((f) => f.id)),
        itemIdsJson: JSON.stringify(t.assessments.map((r) => A.get(r)!)),
        noteIdsJson: JSON.stringify(t.notes.map((r) => N.get(r)!)),
        inputHash: topicInputHash(lectures, practice),
      };
      // The same chapter under its old key, or under another key with the
      // same decks: keep what was written, so a rename costs nothing.
      const match = byKey.get(t.key) ?? old.find((o) => !kept.has(o.id) && sameSet(list(o.lectureIdsJson), lectures.map((f) => f.id)));
      if (match) {
        kept.add(match.id);
        tx.update(guideTopics).set({ ...values, key: t.key }).where(eq(guideTopics.id, match.id)).run();
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
    const gone = old.filter((o) => !kept.has(o.id) && !plan.topics.some((t) => t.key === o.key)).map((o) => o.id);
    if (gone.length) tx.delete(guideTopics).where(inArray(guideTopics.id, gone)).run();
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
    if (t.body && t.builtHash !== t.inputHash) lines.push(`> *Newer slides are out for this topic. This chapter is being updated and will change here on its own.*`);
    if (t.body) lines.push("", t.body);
    else lines.push("", `*This chapter is being written from ${decks.join(", ") || "the slides"}. It will appear here on its own${t.error ? " (the last attempt failed and will be retried)" : ""}.*`);
    return { deck: null, markdown: lines.join("\n\n").replace(/\n{3,}/g, "\n\n") };
  });

  const ready = topics.filter((t) => t.body).length;
  const latest = Math.max(0, ...topics.map((t) => t.builtAt ?? 0));
  const title = plan?.title || `${shortModuleName(mod.code, mod.name)} study guide`;
  const preamble = `# ${title}\n\n*${mod.code}. Written from the newest copy of each lecture deck and kept up to date on its own: when slides change on Canvas, only the chapters they touch are rewritten. ${ready} of ${topics.length} chapters ready${latest ? `, last updated ${shortDate(latest)}` : ""}.*`;
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
// The next chapter to write anywhere: one whose slides have moved past what
// it was written from, not in error backoff, for a student with a model.
// Topics with the soonest quiz or assignment go first, then the newest decks.
export function nextTopic(db: Db, now: number, hasModel: (userId: number) => boolean): { topic: Topic; mod: Mod } | null {
  const mods = new Map(db.select().from(modules).where(and(eq(modules.active, true), eq(modules.hidden, false))).all().map((m) => [m.id, m]));
  const due = db.select().from(guideTopics).all().filter((t) =>
    mods.has(t.moduleId) && t.builtHash !== t.inputHash && (!t.errorAt || now - t.errorAt > ERROR_BACKOFF) && hasModel(mods.get(t.moduleId)!.userId));
  if (!due.length) return null;
  const itemIds = [...new Set(due.flatMap((t) => list(t.itemIdsJson)))];
  const dueAt = new Map(itemIds.length ? db.select({ id: items.id, d: items.dueAt, s: items.submitted }).from(items).where(inArray(items.id, itemIds)).all().map((i) => [i.id, i.s ? null : i.d]) : []);
  const fileIds = [...new Set(due.flatMap((t) => list(t.lectureIdsJson)))];
  const seen = new Map(fileIds.length ? db.select({ id: files.id, at: files.discoveredAt }).from(files).where(inArray(files.id, fileIds)).all().map((f) => [f.id, f.at]) : []);
  const soonest = (t: Topic) => Math.min(Infinity, ...list(t.itemIdsJson).map((id) => dueAt.get(id)).filter((d): d is number => d != null && d > now));
  const newest = (t: Topic) => Math.max(0, ...list(t.lectureIdsJson).map((id) => seen.get(id) ?? 0));
  due.sort((a, b) => soonest(a) - soonest(b) || newest(b) - newest(a) || a.ord - b.ord);
  return { topic: due[0], mod: mods.get(due[0].moduleId)! };
}

export async function writeTopic(deps: GuideDeps, topic: Topic, mod: Mod): Promise<boolean> {
  const { db } = deps;
  const cfg = deps.cfgFor(mod.userId);
  if (!cfg) return false;
  const target = topic.inputHash;
  const setStage = (stage: string | null) => db.update(guideTopics).set({ stage }).where(eq(guideTopics.id, topic.id)).run();
  setStage("Reading the slides");
  try {
    const load = async (ids: number[]) => {
      const rows = ids.length ? db.select().from(files).where(inArray(files.id, ids)).all() : [];
      const out: { name: string; text: string }[] = [];
      for (const id of ids) {
        const f = rows.find((r) => r.id === id);
        if (!f) continue;
        const text = await deps.fileText(mod.userId, f, mod);
        if (text?.trim()) out.push({ name: stem(f.displayName), text });
      }
      return out;
    };
    const lectures = await load(list(topic.lectureIdsJson));
    const practice = await load(list(topic.practiceIdsJson));
    const { body, problems } = await generateTopicChapter({
      cfg, reader: deps.readerFor(mod.userId, mod.id), title: topic.title, lectures, practice,
      onStage: (s) => setStage(s),
    });
    db.update(guideTopics).set({ body, builtHash: target, builtAt: deps.now(), stage: null, error: problems.length ? problems.slice(0, 3).join("; ").slice(0, 300) : null, errorAt: null })
      .where(eq(guideTopics.id, topic.id)).run();
    deps.log?.(`guide chapter written: ${mod.code} "${topic.title}" (${body.length} chars)`);
  } catch (err) {
    db.update(guideTopics).set({ stage: null, error: String(err instanceof Error ? err.message : err).slice(0, 300), errorAt: deps.now() })
      .where(eq(guideTopics.id, topic.id)).run();
  }
  assembleGuide(db, mod, deps.now());
  return true;
}

// --- the loop ---------------------------------------------------------------------
// Preparation (fingerprints, plans, headers) is cheap and done for every
// module each pass; then at most one chapter is written, since that takes
// minutes and the model's rate limit is shared with everything else.
export async function runAutoGuides(deps: GuideDeps): Promise<void> {
  const { db } = deps;
  // Only one chapter is ever being written, and only from here: a stage left
  // behind belongs to a write the worker did not live to finish.
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
  const next = nextTopic(db, deps.now(), (userId) => Boolean(deps.cfgFor(userId)));
  if (next) await writeTopic(deps, next.topic, next.mod);
}

export { guideStatus, requestGuideRefresh } from "../server/guide-status";
