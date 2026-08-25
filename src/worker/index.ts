// src/worker/index.ts — run: npm run worker
import Anthropic from "@anthropic-ai/sdk";
import { eq, and, isNull, or, inArray } from "drizzle-orm";
import { createDb } from "../db/client";
import { components, items, modules, users } from "../db/schema";
import { applyCanvasSync, applyExtractedActions, recordActionFailure, selectActionCandidates, setModuleActivity, shouldAttemptWeightage, upsertMailItems } from "../db/repo";
import { loadEnv } from "../lib/env";
import { decrypt, encrypt } from "../lib/crypto";
import { createCanvasClient, isPdfFile } from "../connectors/canvas/client";
import { normalizeCanvasCourse } from "../connectors/canvas/normalize";
import { fetchInboxDelta } from "../connectors/graph/client";
import { refreshAccessToken } from "../connectors/graph/auth";
import { linkMailToModule, normalizeMail } from "../connectors/graph/normalize";
import { triageEmail } from "../enrich/rules";
import { createScorer } from "../enrich/llm";
import { createCompatScorer, createCompatWeightageExtractor } from "./../enrich/openai-compat";
import { createCompatActionExtractor } from "../enrich/actions";
import { createCompatDeadlineClassifier } from "../enrich/classify";
import { createWeightageExtractor, type WeightageSourceText, type WeightageSourcePdf } from "../enrich/weightage";
import { createGuard, runUserSync } from "./sync";
import { extractPdfText } from "../lib/pdf-text";
import { focusAssessmentText } from "../lib/assessment-focus";

const env = loadEnv();
const db = createDb(env.DATABASE_PATH);

// Provider selection: OpenAI-compatible endpoint (Agnes agrouter) wins when
// configured; otherwise Anthropic; otherwise rules-only. The compat path has
// no PDF document support, so PDF syllabus sources are only gathered on the
// Anthropic path.
const compatCfg = env.OPENAI_COMPAT_BASE_URL && env.OPENAI_COMPAT_API_KEY
  ? { baseUrl: env.OPENAI_COMPAT_BASE_URL, apiKey: env.OPENAI_COMPAT_API_KEY, model: env.OPENAI_COMPAT_MODEL }
  : null;
const anthropic = !compatCfg && env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
const scorer = compatCfg ? createCompatScorer(compatCfg) : anthropic ? createScorer(anthropic, env.ANTHROPIC_MODEL) : null;
const anthropicExtractor = anthropic ? createWeightageExtractor(anthropic, env.ANTHROPIC_MODEL) : null;
const compatExtractor = compatCfg ? createCompatWeightageExtractor(compatCfg) : null;
const extractor = compatCfg
  ? (texts: WeightageSourceText[], _pdfs?: WeightageSourcePdf[]) => compatExtractor!(texts)
  : anthropicExtractor;
const supportsPdfSources = Boolean(anthropic);
const actionExtractor = compatCfg ? createCompatActionExtractor(compatCfg) : null; // Anthropic-path parity: future work
const deadlineClassifier = compatCfg ? createCompatDeadlineClassifier(compatCfg) : null;
if (compatCfg) console.log(`llm provider: openai-compat ${compatCfg.model} @ ${compatCfg.baseUrl} (pdf sources disabled)`);

const SYLLABUS_NAME_RE = /(syllabus|assessment|grading|outline)/i;

async function canvasSync(userId: number): Promise<void> {
  const user = db.select().from(users).where(eq(users.id, userId)).get()!;
  if (!user.canvasTokenEnc) return;
  const canvas = createCanvasClient(env.CANVAS_BASE_URL, decrypt(user.canvasTokenEnc, env.SECRET_KEY));
  for (const course of await canvas.listActiveCourses()) {
    const [groups, announcements, events] = await Promise.all([
      canvas.listAssignmentGroups(course.id),
      canvas.listAnnouncements(course.id),
      canvas.listCalendarEvents(course.id),
    ]);
    const sync = normalizeCanvasCourse(course, groups, announcements, events);
    const { moduleId } = applyCanvasSync(db, userId, sync, Date.now());

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
async function loop(): Promise<void> {
  for (const user of db.select().from(users).all()) {
    await runUserSync({
      db, now: Date.now,
      canvasSync: guard("canvas", canvasSync),
      mailSync: guard("graph", mailSync),
      enrich: guard("enrich", enrich),
    }, user.id);
  }
  setTimeout(loop, env.POLL_INTERVAL_MS);
}
console.log("openpapr worker starting");
void loop();
