// src/worker/index.ts — run: npm run worker
import Anthropic from "@anthropic-ai/sdk";
import { eq, and, isNull, or, inArray } from "drizzle-orm";
import { createDb } from "../db/client";
import { components, items, modules, users } from "../db/schema";
import { applyCanvasSync, applyExtractedActions, markSyncStarted, recordActionFailure, selectActionCandidates, selectDueUsers, selectRequestedUsers, takeSyncRequest, upsertModuleFiles, type DiscoveredFile,
  claimNextGuideRun, updateGuideRun, failStaleGuideRuns, upsertStudyGuide, setModuleActivity, shouldAttemptWeightage, upsertMailItems, recordCanvasTokenCheck } from "../db/repo";
import { loadEnv } from "../lib/env";
import { decrypt, encrypt } from "../lib/crypto";
import { createCanvasClient, isPdfFile, type CanvasClient } from "../connectors/canvas/client";
import { extractCanvasFileLinks, type FileLinkSource } from "../lib/canvas-file-links";
import { categorizeModuleFiles, createCompatFileCategorizer } from "../enrich/file-category";
import { generateModuleGuide } from "../enrich/generate-guide";
import { normalizeCanvasCourse } from "../connectors/canvas/normalize";
import { fetchInboxDelta } from "../connectors/graph/client";
import { refreshAccessToken } from "../connectors/graph/auth";
import { linkMailToModule, normalizeMail } from "../connectors/graph/normalize";
import { triageEmail } from "../enrich/rules";
import { createScorer } from "../enrich/llm";
import { createCompatScorer, createCompatWeightageExtractor } from "./../enrich/openai-compat";
import { createCompatActionExtractor } from "../enrich/actions";
import { createCompatDeadlineClassifier } from "../enrich/classify";
import { createWeightageExtractor, type ExtractedComponent, type WeightageSourceText, type WeightageSourcePdf } from "../enrich/weightage";
import type { CompatConfig } from "../enrich/openai-compat";
import { sharedLlmConfig, userLlmConfig } from "../lib/llm-provider";
import { createGuard, runUserSync } from "./sync";
import { clearProfileRequests, refreshProfiles, usersWithProfileRequests, type ProfileDeps } from "./profiles";
import { getModuleProfileRow } from "../db/profiles-repo";
import { readFileSync } from "node:fs";
import { ensurePdf } from "../server/files";
import { getStudyGuide } from "../db/repo";
import { assembleGuide, mergeChapters, splitChapters } from "../lib/guide-chapters";
import { ModuleProfile, UserProfile, WritingStyle, readerBrief } from "../enrich/profiles";
import { extractPdfText } from "../lib/pdf-text";
import { focusAssessmentText } from "../lib/assessment-focus";

const env = loadEnv();
const db = createDb(env.DATABASE_PATH);

// Provider selection, per user. A student who has saved their own key in
// Account gets every model call made with it; everyone else uses the
// deployment's shared provider — the OpenAI-compatible endpoint when
// configured, otherwise Anthropic, otherwise rules only. A student's key is
// never swapped for the shared one when it fails: that would hide the error
// and spend someone else's credit.
//
// The compat path has no PDF document support, so PDF syllabus sources are
// only gathered on the Anthropic path.
type LlmKit = {
  compatCfg: CompatConfig | null;
  scorer: ReturnType<typeof createScorer> | null;
  extractor: ((texts: WeightageSourceText[], pdfs?: WeightageSourcePdf[]) => Promise<ExtractedComponent[] | null>) | null;
  supportsPdfSources: boolean;
  actionExtractor: ReturnType<typeof createCompatActionExtractor> | null; // Anthropic-path parity: future work
  deadlineClassifier: ReturnType<typeof createCompatDeadlineClassifier> | null;
  fileCategorizer: ReturnType<typeof createCompatFileCategorizer> | null;
};

function compatKit(cfg: CompatConfig): LlmKit {
  const compatExtractor = createCompatWeightageExtractor(cfg);
  return {
    compatCfg: cfg,
    scorer: createCompatScorer(cfg),
    extractor: (texts) => compatExtractor(texts),
    supportsPdfSources: false,
    actionExtractor: createCompatActionExtractor(cfg),
    deadlineClassifier: createCompatDeadlineClassifier(cfg),
    fileCategorizer: createCompatFileCategorizer(cfg),
  };
}

const sharedCfg = sharedLlmConfig(env);
const anthropic = !sharedCfg && env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
const sharedKit: LlmKit = sharedCfg ? compatKit(sharedCfg) : {
  compatCfg: null,
  scorer: anthropic ? createScorer(anthropic, env.ANTHROPIC_MODEL) : null,
  extractor: anthropic ? createWeightageExtractor(anthropic, env.ANTHROPIC_MODEL) : null,
  supportsPdfSources: Boolean(anthropic),
  actionExtractor: null, deadlineClassifier: null, fileCategorizer: null,
};
if (sharedCfg) console.log(`shared llm provider: openai-compat ${sharedCfg.model} @ ${sharedCfg.baseUrl} (pdf sources disabled)`);

// Built once per distinct saved config and reused across cycles; a change in
// Account shows up as a new signature and replaces the entry.
const userKits = new Map<number, { sig: string; kit: LlmKit }>();
function kitFor(userId: number): LlmKit {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  const own = user ? userLlmConfig(user, env.SECRET_KEY) : null;
  if (!own) { userKits.delete(userId); return sharedKit; }
  const sig = `${own.baseUrl}\n${own.model}\n${user!.llmKeyEnc}`;
  const hit = userKits.get(userId);
  if (hit && hit.sig === sig) return hit.kit;
  const kit = compatKit(own);
  userKits.set(userId, { sig, kit });
  return kit;
}

const SYLLABUS_NAME_RE = /(syllabus|assessment|grading|outline)/i;

// Records every file a module has, from two sources that barely overlap: the
// Files listing, and links pasted into announcements or the syllabus. Some
// courses keep their entire deck set in the second category — IFS4103's Files
// tab holds two recruitment posters while its lecture slides are reachable
// only by id, hidden from the listing, and the study guide for that module
// consequently had no slides to cite.
//
// Only files LINKED FROM CONTENT the student can already read are harvested.
// hidden:true can mean deliberately withheld as well as merely unlisted, and
// following a link the course itself published is what keeps the distinction
// honest.
async function harvestFiles(
  canvas: CanvasClient,
  courseId: number,
  moduleId: number,
  sources: FileLinkSource[],
  fileCategorizer: LlmKit["fileCategorizer"],
): Promise<void> {
  const discovered = new Map<number, DiscoveredFile>();

  const listed = await (async () => {
    try { return await canvas.listCourseFiles(courseId); } catch { return []; }
  })();
  for (const f of listed) {
    discovered.set(f.id, {
      canvasFileId: f.id, displayName: f.display_name,
      contentType: f["content-type"] ?? null, sizeBytes: f.size ?? null, hidden: false,
    });
  }

  // Pages carry the links the Files tab omits: IFS4103 publishes its lecture
  // decks on two content pages and nowhere else. Page counts are small (2-7
  // across the active modules) so this is a handful of extra calls, but the
  // cap stops a course with a large wiki from dominating a sync cycle.
  const fromPages: FileLinkSource[] = [];
  try {
    for (const page of (await canvas.listPages(courseId)).slice(0, 25)) {
      try { fromPages.push({ label: page.title, html: await canvas.getPageBody(courseId, page.url) }); } catch { /* single page unreadable */ }
    }
  } catch {
    // Pages are disabled for some courses (CS4239 returns 404); not an error.
  }

  for (const link of extractCanvasFileLinks([...sources, ...fromPages])) {
    const listed = discovered.get(link.id);
    if (listed) {
      // Listed AND linked: keep the link's context, it helps categorisation.
      listed.linkedFrom = link.linkedFrom;
      listed.linkContext = link.context;
      continue;
    }
    try {
      const f = await canvas.getFile(link.id);
      discovered.set(link.id, {
        canvasFileId: f.id, displayName: f.display_name,
        contentType: f["content-type"] ?? null, sizeBytes: f.size ?? null, hidden: true,
        linkedFrom: link.linkedFrom, linkContext: link.context,
      });
    } catch {
      // A link can point at a file the student cannot read, or one since
      // deleted. Skip it rather than failing the whole course sync.
    }
  }

  if (discovered.size > 0) upsertModuleFiles(db, moduleId, [...discovered.values()], Date.now());
  await categorizeModuleFiles(db, moduleId, fileCategorizer);
}

async function canvasSync(userId: number): Promise<void> {
  const user = db.select().from(users).where(eq(users.id, userId)).get()!;
  if (!user.canvasTokenEnc) return;
  const canvas = createCanvasClient(env.CANVAS_BASE_URL, decrypt(user.canvasTokenEnc, env.SECRET_KEY));
  const { extractor, supportsPdfSources, fileCategorizer } = kitFor(userId);
  let courses: Awaited<ReturnType<CanvasClient["listActiveCourses"]>>;
  try {
    courses = await canvas.listActiveCourses();
  } catch (err) {
    // 401 is Canvas saying the token itself is dead (expired or revoked), as
    // opposed to an outage; that is what the account page warns about.
    if (/^Error: Canvas 401 /.test(String(err))) recordCanvasTokenCheck(db, userId, false, Date.now());
    throw err;
  }
  recordCanvasTokenCheck(db, userId, true, Date.now());
  for (const course of courses) {
    const [groups, announcements, events] = await Promise.all([
      canvas.listAssignmentGroups(course.id),
      canvas.listAnnouncements(course.id),
      canvas.listCalendarEvents(course.id),
    ]);
    const sync = normalizeCanvasCourse(course, groups, announcements, events);
    const { moduleId } = applyCanvasSync(db, userId, sync, Date.now());

    await harvestFiles(canvas, course.id, moduleId, [
      ...announcements.map((a) => ({ label: a.title, html: a.message })),
      { label: "Syllabus", html: course.syllabus_body ?? null },
    ], fileCategorizer);

    // Weightage extraction: component-less modules only, at most weekly.
    if (!extractor) continue;
    const modRow = db.select().from(modules).where(eq(modules.id, moduleId)).get()!;
    const have = db.select().from(components).where(eq(components.moduleId, moduleId)).all();
    if (!shouldAttemptWeightage(have.length, modRow.weightageCheckedAt, Date.now())) continue;
    // Pages/files are OPTIONAL weightage sources: courses can have the Pages or
    // Files feature disabled (Canvas returns 404 "disabled for this course"),
    // and that must not abort the sync of this or later courses.
    const optional = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
      try { return await p; } catch { return fallback; }
    };
    const texts: WeightageSourceText[] = [];
    if (sync.module.syllabusBody) texts.push({ label: "Canvas syllabus page", text: sync.module.syllabusBody });
    for (const p of (await optional(canvas.listPages(course.id), [])).filter((p) => SYLLABUS_NAME_RE.test(p.title)).slice(0, 3))
      texts.push({ label: `Page: ${p.title}`, text: await optional(canvas.getPageBody(course.id, p.url), "") });
    // Candidate PDFs: syllabus-named files, else week-0/admin-looking decks
    // (profs often put the assessment breakdown in the prelim slides).
    let candidateFiles = (await optional(canvas.listSyllabusFiles(course.id), [])).filter(isPdfFile);
    if (candidateFiles.length === 0) {
      const DECK_RE = /(prelim|intro|week ?0|u0|admin|assess|outline|course.?info)/i;
      candidateFiles = (await optional(canvas.listCourseFiles(course.id), []))
        .filter((f) => isPdfFile(f) && DECK_RE.test(f.display_name));
    }
    candidateFiles = candidateFiles.slice(0, 2);
    const pdfs: WeightageSourcePdf[] = [];
    for (const f of candidateFiles) {
      const bytes = await optional(canvas.downloadFile(f.url), new Uint8Array());
      if (bytes.length === 0) continue;
      if (supportsPdfSources) {
        pdfs.push({ label: f.display_name, base64: Buffer.from(bytes).toString("base64") });
      } else {
        const text = await extractPdfText(bytes);
        if (text.trim()) texts.push({ label: `Slides: ${f.display_name}`, text: focusAssessmentText(text) });
      }
    }
    const extracted = await extractor(texts, pdfs);
    db.update(modules).set({ weightageCheckedAt: Date.now() }).where(eq(modules.id, moduleId)).run();
    if (extracted) for (const c of extracted) {
      db.insert(components).values({ moduleId, name: c.name, weightPct: c.weightPct, source: "llm_syllabus", evidence: c.evidence })
        .onConflictDoNothing().run();
    }
  }
  setModuleActivity(db, userId);
}

async function mailSync(userId: number): Promise<void> {
  const user = db.select().from(users).where(eq(users.id, userId)).get()!;
  if (!user.msRefreshTokenEnc || !env.MS_CLIENT_ID) return;
  const { accessToken, refreshToken } = await refreshAccessToken(env.MS_CLIENT_ID, decrypt(user.msRefreshTokenEnc, env.SECRET_KEY));
  const { messages, deltaLink } = await fetchInboxDelta(accessToken, user.msDeltaLink);
  const byCode = new Map(db.select().from(modules).where(eq(modules.userId, userId)).all().map((m) => [m.code, m.id]));
  upsertMailItems(db, userId, messages.filter((m) => m.id).map((m) => linkMailToModule(normalizeMail(m), byCode)), Date.now());
  db.update(users).set({ msDeltaLink: deltaLink, msRefreshTokenEnc: encrypt(refreshToken, env.SECRET_KEY) })
    .where(eq(users.id, userId)).run();
}

async function enrich(userId: number): Promise<void> {
  const { scorer, actionExtractor, deadlineClassifier } = kitFor(userId);
  const activeCodes = db.select().from(modules).where(and(eq(modules.userId, userId), eq(modules.active, true))).all().map((m) => m.code);
  const pending = db.select().from(items).where(and(
    eq(items.userId, userId), eq(items.type, "email"),
    or(isNull(items.triage), inArray(items.triage, ["unscored"])),
  )).all();
  for (const mail of pending) {
    const ruled = triageEmail({ sender: mail.sender, title: mail.title, body: mail.body, moduleId: mail.moduleId }, { activeCodes });
    if (ruled.verdict !== "ambiguous" || !scorer) {
      db.update(items).set({ triage: ruled.verdict === "ambiguous" ? "unscored" : ruled.verdict, importanceReason: ruled.reason })
        .where(eq(items.id, mail.id)).run();
      continue;
    }
    const scored = await scorer({ sender: mail.sender, title: mail.title, body: mail.body });
    db.update(items).set({ triage: scored.triage, importance: scored.importance, importanceReason: scored.reason })
      .where(eq(items.id, mail.id)).run();
  }

  // Deadline extraction: announcements + important emails from ACTIVE modules
  // (emails with no module link included), once per item, capped per cycle so
  // a cold start can't burst the LLM budget. A null result counts as a failed
  // attempt and is retried on later cycles, but only up to MAX_ACTION_ATTEMPTS
  // — an item the extractor can never parse must not be retried forever.
  if (!actionExtractor) return;
  const activeIds = new Set(
    db.select().from(modules).where(and(eq(modules.userId, userId), eq(modules.active, true))).all().map((m) => m.id));
  for (const item of selectActionCandidates(db, userId, activeIds)) {
    const actions = await actionExtractor({ title: item.title, body: item.body, postedAt: item.sourceCreatedAt ?? item.firstSeenAt });
    if (actions === null) {
      recordActionFailure(db, item.id);
      continue;
    }
    applyExtractedActions(db, userId, item.id, actions, Date.now());
  }

  // Classify unclassified deadlines in one batched call per cycle.
  if (!deadlineClassifier) return;
  const codeById = new Map(db.select().from(modules).where(eq(modules.userId, userId)).all().map((m) => [m.id, m.code]));
  const unclassified = db.select().from(items).where(and(
    eq(items.userId, userId), eq(items.type, "deadline"), isNull(items.category),
  )).all().slice(0, 50);
  if (unclassified.length === 0) return;
  const result = await deadlineClassifier(unclassified.map((d) => ({
    id: d.id, title: d.title, module: d.moduleId !== null ? codeById.get(d.moduleId) ?? null : null,
  })));
  if (result) for (const [id, category] of result)
    db.update(items).set({ category }).where(eq(items.id, id)).run();
}

const guard = createGuard(env.POLL_INTERVAL_MS);

const deps = {
  db, now: Date.now,
  canvasSync: guard("canvas", canvasSync),
  mailSync: guard("graph", mailSync),
  enrich: guard("enrich", enrich),
};

// Two cadences on one timer. The fast tick exists so "Sync now" is picked up
// within seconds — the web server and the worker are separate processes, so a
// request reaches here as a database flag rather than a call. The scheduled
// sweep stays slow and capped so signups keep fanning out across the interval
// instead of hitting Canvas in one burst; running it on the fast tick would
// admit everyone at once and undo the stagger.
const TICKS_PER_INTERVAL = 10;
const TICK_MS = 2_000;
const SWEEP_MS = Math.max(15_000, Math.floor(env.POLL_INTERVAL_MS / TICKS_PER_INTERVAL));
let lastSweepAt = 0;

const profileDeps: ProfileDeps = {
  db, now: Date.now,
  disqusKey: env.DISQUS_API_KEY ?? null,
  cfgFor: (userId) => kitFor(userId).compatCfg,
  canvasFor: (userId) => {
    const u = db.select().from(users).where(eq(users.id, userId)).get();
    if (!u?.canvasTokenEnc) return null;
    try { return createCanvasClient(env.CANVAS_BASE_URL, decrypt(u.canvasTokenEnc, env.SECRET_KEY)); } catch { return null; }
  },
};

// Profiles are built after the sync that feeds them, and never fail it: a
// model that is down leaves yesterday's profile standing.
const profileGuard = createGuard(env.POLL_INTERVAL_MS);
const guardedProfiles = profileGuard("profiles", async (userId: number) => {
  let r: Awaited<ReturnType<typeof refreshProfiles>>;
  try {
    r = await refreshProfiles(profileDeps, userId);
  } catch (err) {
    clearProfileRequests(db, userId, String(err instanceof Error ? err.message : err).slice(0, 300));
    throw err;
  }
  clearProfileRequests(db, userId, null);
  if (r.modules || r.user || r.plan || r.style) {
    console.log(`profiles for user ${userId}: ${r.modules} module(s)${r.style ? ", style" : ""}${r.user ? ", profile" : ""}${r.plan ? ", plan" : ""}`);
  }
  if (r.errors.length) console.warn(`profile issues for user ${userId}: ${r.errors.slice(0, 4).join(" | ")}`);
});

async function runFor(userId: number): Promise<void> {
  markSyncStarted(db, userId, Date.now());
  await runUserSync(deps, userId);
  await guardedProfiles(userId).catch(() => {});
}

function parseJson<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } }, json: string | null | undefined): T | null {
  if (!json) return null;
  try { const r = schema.safeParse(JSON.parse(json)); return r.success ? (r.data as T) : null; } catch { return null; }
}

// One generation at a time, on the same tick as everything else. It takes
// minutes, so it runs after the fast paths and writes progress as it goes for
// the module page to poll.
async function runGuideJob(): Promise<void> {
  failStaleGuideRuns(db, Date.now());
  const run = claimNextGuideRun(db, Date.now());
  if (!run) return;

  const user = db.select().from(users).where(eq(users.id, run.userId)).get();
  const compatCfg = user ? kitFor(user.id).compatCfg : null;
  if (!user?.canvasTokenEnc || !compatCfg) {
    updateGuideRun(db, run.id, {
      finishedAt: Date.now(), ok: false, stage: "Unavailable",
      error: !compatCfg ? "no AI provider — add your own API key in Account" : "no canvas token",
    });
    return;
  }

  console.log(`generating study guide for module ${run.moduleId}`);
  try {
    const canvas = createCanvasClient(env.CANVAS_BASE_URL, decrypt(user.canvasTokenEnc, env.SECRET_KEY));
    let fileIds: number[] | null = null;
    try { fileIds = run.fileIdsJson ? (JSON.parse(run.fileIdsJson) as number[]) : null; } catch { fileIds = null; }
    const mod = db.select().from(modules).where(eq(modules.id, run.moduleId)).get()!;
    const result = await generateModuleGuide({
      db, canvas, cfg: compatCfg, moduleId: run.moduleId, fileIds,
      // From the volume cache when the viewer or an earlier run has fetched
      // it already; PowerPoint and Word files are converted once.
      loadPdf: async (file) => {
        const served = await ensurePdf(db, run.userId, { file, mod });
        if ("error" in served) throw new Error(served.error);
        return new Uint8Array(readFileSync(served.path));
      },
      reader: readerBrief(
        parseJson<UserProfile>(UserProfile, user.profileJson),
        user.styleLearning ? parseJson<WritingStyle>(WritingStyle, user.writingStyleJson) : null,
        parseJson<ModuleProfile>(ModuleProfile, getModuleProfileRow(db, run.moduleId)?.profileJson),
      ),
      onProgress: (p) => updateGuideRun(db, run.id, {
        stage: p.stage, decksTotal: p.decksTotal, decksDone: p.decksDone,
        sectionsTotal: p.sectionsTotal, sectionsDone: p.sectionsDone,
      }),
    });
    let markdown = result.markdown;
    let sourceNote = result.sourceNote;
    const previous = run.mode === "merge" ? getStudyGuide(db, run.moduleId) : undefined;
    if (previous) {
      // Only the chosen chapters are rewritten; the rest of the guide stays.
      const fresh = splitChapters(result.markdown);
      const old = splitChapters(previous.markdown);
      const merged = mergeChapters(old.chapters, fresh.chapters);
      markdown = assembleGuide(old.preamble || fresh.preamble, merged);
      sourceNote = `${merged.length} chapter${merged.length === 1 ? "" : "s"}; ${result.decks.length} updated with ${compatCfg.model}`;
    }
    upsertStudyGuide(db, run.moduleId, markdown, sourceNote, Date.now());
    updateGuideRun(db, run.id, {
      finishedAt: Date.now(), ok: true, stage: "Done",
      error: result.problems.length ? result.problems.slice(0, 5).join("; ") : null,
    });
    console.log(`guide stored for module ${run.moduleId}: ${result.markdown.length} chars`);
  } catch (err) {
    updateGuideRun(db, run.id, {
      finishedAt: Date.now(), ok: false, stage: "Failed",
      error: String(err instanceof Error ? err.message : err).slice(0, 300),
    });
    console.error(`guide generation failed for module ${run.moduleId}`, err);
  }
}

async function tick(): Promise<void> {
  try {
    for (const user of selectRequestedUsers(db)) {
      // Clear first: an unclaimed flag would restart the cycle every 2s.
      if (!takeSyncRequest(db, user.id)) continue;
      guard.resetUser(user.id);
      console.log(`manual sync requested for user ${user.id}`);
      await runFor(user.id);
    }

    const now = Date.now();
    if (now - lastSweepAt >= SWEEP_MS) {
      lastSweepAt = now;
      const total = db.select().from(users).all().length;
      const cap = Math.max(1, Math.ceil(total / TICKS_PER_INTERVAL));
      for (const user of selectDueUsers(db, Date.now(), env.POLL_INTERVAL_MS, cap)) {
        await runFor(user.id);
      }
    }
    for (const userId of usersWithProfileRequests(db)) {
      profileGuard.resetUser(userId);
      await guardedProfiles(userId).catch(() => {});
    }
    await runGuideJob();
  } catch (err) {
    console.error("worker tick failed", err);
  }
  setTimeout(tick, TICK_MS);
}
console.log("openpapr worker starting");
void tick();
