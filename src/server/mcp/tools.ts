import { readFileSync, statSync } from "node:fs";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { canvasMessages, canvasPages, components, files, items, mailAttachments, modules, slideNotes, tasks, users } from "@/db/schema";
import type { Grade } from "@/connectors/canvas/normalize";
import { parseOutline, type OutlineItem } from "@/lib/course-outline";
import { getStudyGuide } from "@/db/repo";
import { slidePages } from "@/enrich/study-guide";
import { extractCanvasFileIds } from "@/lib/canvas-file-links";
import { fileKind, servedType } from "@/lib/file-kind";
import { htmlToText } from "@/lib/html-text";
import { categoryLabel } from "@/lib/materials";
import { moduleDisplay } from "@/lib/module-display";
import { cachedOcrText } from "@/lib/ocr-cache";
import { extractPdfText } from "@/lib/pdf-text";
import { sgtDate, sgtHHMM } from "@/lib/sgt";
import { extractSubheadings, slugifyHeading, splitGuideIntoChapters } from "@/lib/study-chapters";
import { renderCachedSlide } from "../deck";
import { ensureOriginal, ensurePdf, officeFileToPdf } from "../files";
import { moduleProfileView, userProfileView, weeklyPlanView } from "../profiles";
import { retrieve } from "../retrieve";
import { search } from "../search";
import { text, ToolError, type Tool, type ToolResult } from "./protocol";

// What Claude Code can read of a student's OpenPapr: their modules, every
// file of every module (as text, or a page as an image), the study guides,
// announcements, emails and other Canvas items, tasks and their own notes.
// Everything is read-only and scoped to the key's account — each query is
// filtered by the user id the key resolved to, never by anything the caller
// says. Secrets (tokens, keys, the password) are never read at all.

export type Ctx = { db: Db; userId: number; now: number };

// A reply larger than this is cut, with a note saying how to ask for the
// rest; it keeps one call from filling the model's context.
export const MAX_CHARS = 50_000;
const D = 86_400_000;

const when = (ms: number | null | undefined) => (ms ? `${sgtDate(ms)} ${sgtHHMM(ms)}` : "—");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const parse = <T,>(json: string | null | undefined, fallback: T): T => { try { return json ? (JSON.parse(json) as T) : fallback; } catch { return fallback; } };
const sizeLabel = (n: number | null) => (n === null ? "" : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

// --- modules -------------------------------------------------------------------

type Mod = typeof modules.$inferSelect;
const modulesOf = (ctx: Ctx) => ctx.db.select().from(modules).where(eq(modules.userId, ctx.userId)).all();
const title = (m: Mod) => moduleDisplay(m).title;

// A module by id or by code ("CS4239", "cs4239"). A code taken twice (a
// module retaken, or a lecture and its lab) prefers the active one, then the newest.
export function findModule(ctx: Ctx, ref: string): Mod {
  const mods = modulesOf(ctx);
  const want = ref.trim().toLowerCase();
  const byId = /^\d+$/.test(want) ? mods.find((m) => m.id === Number(want)) : undefined;
  if (byId) return byId;
  const hits = mods.filter((m) => m.code.toLowerCase() === want)
    .concat(mods.filter((m) => m.code.toLowerCase() !== want && m.code.toLowerCase().startsWith(want)));
  hits.sort((a, b) => Number(b.active) - Number(a.active) || b.id - a.id);
  if (hits[0]) return hits[0];
  const codes = mods.filter((m) => m.active).map((m) => m.code).join(", ");
  throw new ToolError(`No module "${ref}". Your modules: ${codes || "none yet"}. Pass a code or an id from list_modules.`);
}
const moduleIdsFor = (ctx: Ctx, ref: string | undefined) => (ref ? [findModule(ctx, ref).id] : modulesOf(ctx).map((m) => m.id));

// --- files ---------------------------------------------------------------------

type FileRow = typeof files.$inferSelect;
function ownedFileById(ctx: Ctx, fileId: number): { file: FileRow; mod: Mod } {
  const row = ctx.db.select({ file: files, mod: modules }).from(files)
    .innerJoin(modules, eq(files.moduleId, modules.id))
    .where(and(eq(files.id, fileId), eq(modules.userId, ctx.userId))).get();
  if (!row) throw new ToolError(`No file #${fileId} in your modules. Use list_files to find one.`);
  return row;
}

// A deck's text is read from the PDF on every call otherwise, which for a
// 20MB deck is a second or two; a few decks are kept, keyed by the copy on disk.
const words = (s: string) => s.match(/[a-z0-9]+/gi)?.length ?? 0;
const deckTexts = new Map<string, { mtimeMs: number; text: string }>();
async function pdfText(path: string): Promise<string> {
  const mtimeMs = statSync(path).mtimeMs;
  const hit = deckTexts.get(path);
  if (hit && hit.mtimeMs === mtimeMs) return hit.text;
  const bytes = new Uint8Array(readFileSync(path));
  let t = await extractPdfText(bytes.slice());
  // A scan has no text of its own; the worker's OCR of it, when it has run,
  // does. Whichever says more, as the worker decides.
  const ocr = cachedOcrText(bytes, `${path}.ocr.txt`);
  if (ocr !== null && words(ocr) > words(t)) t = ocr;
  deckTexts.set(path, { mtimeMs, text: t });
  if (deckTexts.size > 8) deckTexts.delete(deckTexts.keys().next().value!);
  return t;
}

const unopened = (r: { error: string }) => new ToolError(`Could not open the file: ${r.error}.`);

// A PDF's text page by page, from_page to to_page, cut to MAX_CHARS.
async function pdfPages(head: string, name: string, path: string, args: { from_page?: number; to_page?: number; offset?: number }, figureHint: string): Promise<string> {
  const all = await pdfText(path);
  const pages = slidePages(all);
  if (!pages.length) return `${head}\n\n${part(all.trim() || "(no text could be read from this file)", args.offset ?? 0)}`;
  const from = args.from_page ?? 1;
  const to = Math.min(args.to_page ?? pages.length, pages.length);
  if (from > pages.length) throw new ToolError(`${name} has ${pages.length} pages.`);
  const out: string[] = [];
  let used = 0, last = from - 1;
  for (const p of pages.filter((x) => x.page >= from && x.page <= to)) {
    const body = p.text.trim();
    const block = `--- page ${p.page} ---\n${body.replace(/\s/g, "").length < 25 ? `${body}\n(little text: probably a figure — ${figureHint})` : body}`;
    if (used + block.length > MAX_CHARS && out.length) break;
    out.push(block);
    used += block.length;
    last = p.page;
  }
  const more = last < to ? `\n\n[stopped at page ${last} to keep this short — call again with from_page=${last + 1}]` : "";
  return `${head} — ${pages.length} pages, showing ${from}–${last}\n\n${out.join("\n\n")}${more}`;
}

// The module's files a piece of Canvas HTML links to, as read_file ids.
function linkedFiles(ctx: Ctx, moduleId: number | null, html: string | null): string {
  const linked = moduleId ? extractCanvasFileIds(html) : [];
  const rows = linked.length ? ctx.db.select().from(files).where(and(eq(files.moduleId, moduleId!), inArray(files.canvasFileId, linked))).all() : [];
  return rows.length ? `\n\n## Files it links to\n${rows.map((f) => `- file_id ${f.id} · ${f.displayName}`).join("\n")}` : "";
}

// "17/20 (A-)", or the letter alone when Canvas shows no points.
function markOf(json: string | null): string | null {
  const g = parse<Grade | null>(json, null);
  if (!g) return null;
  const pts = g.score !== null ? `${g.score}${g.outOf !== null ? `/${g.outOf}` : ""}` : null;
  const letter = g.grade && g.grade !== String(g.score) ? g.grade : null;
  return pts ? `${pts}${letter ? ` (${letter})` : ""}` : letter;
}

// From `offset`, at most MAX_CHARS, with a note on how to continue.
function part(s: string, offset: number): string {
  if (offset >= s.length && s.length > 0) throw new ToolError(`offset ${offset} is past the end (${s.length} characters).`);
  const part = s.slice(offset, offset + MAX_CHARS);
  const rest = s.length - offset - part.length;
  return rest > 0 ? `${part}\n\n[${rest} more characters — call again with offset=${offset + part.length}]` : part;
}

// --- tools ---------------------------------------------------------------------

// Chapter headings usually carry their number already ("2. Heaps").
const numbered = (label: string, i: number) => (/^\d+[.)]/.test(label) ? label : `${i + 1}. ${label}`);

const moduleArg = z.string().describe("Module code (e.g. \"CS4239\") or id from list_modules");

const overview: Tool<Ctx> = {
  name: "overview",
  title: "Overview",
  description: "Start here. Who the student is, their current modules, this week's plan, what is due in the next two weeks and the last week's announcements.",
  input: z.object({}),
  run(_args, ctx) {
    const u = ctx.db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId)).get();
    const about = userProfileView(ctx.db, ctx.userId);
    const mods = modulesOf(ctx).filter((m) => m.active);
    const code = new Map(modulesOf(ctx).map((m) => [m.id, m.code]));
    const out: string[] = [`# ${u?.name ?? "Student"}`];
    const who = [about.major, about.studyYear ? `year ${about.studyYear}` : null].filter(Boolean).join(", ");
    if (who) out.push(who);
    if (about.profile) out.push(`Profile: ${JSON.stringify(about.profile)}`);
    out.push("", "## Current modules", ...mods.map((m) => `- ${m.code} (id ${m.id}) — ${title(m)}${m.term ? ` · ${m.term}` : ""}`));
    const plan = weeklyPlanView(ctx.db, ctx.userId, ctx.now).plan;
    if (plan) out.push("", "## This week's plan", JSON.stringify(plan));
    const due = ctx.db.select().from(tasks).where(and(eq(tasks.userId, ctx.userId), eq(tasks.status, "open"))).all()
      .filter((t) => t.dueAt !== null && t.dueAt > ctx.now - D && t.dueAt < ctx.now + 14 * D).sort((a, b) => a.dueAt! - b.dueAt!);
    out.push("", "## Due in the next two weeks", ...(due.length ? due.map((t) => `- ${when(t.dueAt)}${t.dueConfidence === "estimated" ? " (estimated)" : ""} · ${code.get(t.moduleId ?? -1) ?? "—"} · ${t.title} (task ${t.id})`) : ["Nothing."]));
    const news = ctx.db.select().from(items).where(and(eq(items.userId, ctx.userId), inArray(items.type, ["announcement", "staff_reply"]))).all()
      .filter((i) => !i.dismissed && (i.sourceCreatedAt ?? i.firstSeenAt) > ctx.now - 7 * D)
      .sort((a, b) => (b.sourceCreatedAt ?? b.firstSeenAt) - (a.sourceCreatedAt ?? a.firstSeenAt));
    out.push("", "## Announcements, last 7 days", ...(news.length ? news.map((i) => `- ${when(i.sourceCreatedAt ?? i.firstSeenAt)} · ${code.get(i.moduleId ?? -1) ?? "—"} · ${i.title} (item ${i.id})`) : ["None."]));
    const msgs = ctx.db.select().from(canvasMessages).where(eq(canvasMessages.userId, ctx.userId)).all()
      .filter((r) => r.author !== "You" && r.sentAt > ctx.now - 7 * D).sort((a, b) => b.sentAt - a.sentAt);
    if (msgs.length) out.push("", "## Messages from lecturers, last 7 days", ...msgs.map((r) => `- ${when(r.sentAt)} · ${code.get(r.moduleId ?? -1) ?? r.courseName ?? "—"} · ${r.author}${r.subject ? `: ${r.subject}` : ""} (message ${r.id})`));
    return text(out.join("\n"));
  },
};

const listModules: Tool<Ctx> = {
  name: "list_modules",
  title: "List modules",
  description: "Every module (course) in OpenPapr, with its id, how many files it has, whether it has a study guide, and its assessment weights.",
  input: z.object({ include_past: z.boolean().optional().describe("Also list modules from earlier terms") }),
  run(args: { include_past?: boolean }, ctx) {
    const mods = modulesOf(ctx).filter((m) => args.include_past || m.active);
    if (!mods.length) return text("No modules yet — the student has not synced Canvas.");
    const ids = mods.map((m) => m.id);
    const fileCount = new Map<number, number>();
    for (const f of ctx.db.select({ m: files.moduleId }).from(files).where(inArray(files.moduleId, ids)).all()) fileCount.set(f.m, (fileCount.get(f.m) ?? 0) + 1);
    const comps = ctx.db.select().from(components).where(inArray(components.moduleId, ids)).all();
    return text(mods.map((m) => {
      const guide = getStudyGuide(ctx.db, m.id);
      const weights = comps.filter((c) => c.moduleId === m.id && c.weightPct !== null).map((c) => `${c.name} ${c.weightPct}%`).join(", ");
      return [
        `## ${m.code} — ${title(m)} (id ${m.id})`,
        `${m.term ?? "term unknown"}${m.active ? "" : " · past"}${m.hidden ? " · hidden on home" : ""} · ${fileCount.get(m.id) ?? 0} files · ${guide ? `study guide (${splitGuideIntoChapters(guide.markdown).chapters.length} chapters)` : "no study guide"}`,
        weights ? `Assessment: ${weights}` : null,
      ].filter(Boolean).join("\n");
    }).join("\n\n"));
  },
};

const getModule: Tool<Ctx> = {
  name: "get_module",
  title: "Module details",
  description: "One module in depth: OpenPapr's profile of it (what it covers, how it is assessed, what students say), lecturers, assessment, its study guide's chapters, its files by category, its open tasks and its syllabus page.",
  input: z.object({ module: moduleArg }),
  run(args: { module: string }, ctx) {
    const m = findModule(ctx, args.module);
    const view = moduleProfileView(ctx.db, m);
    const out = [`# ${m.code} — ${title(m)} (id ${m.id})`, `${m.term ?? ""}${m.active ? "" : " · past module"}`];
    if (view.profile) out.push("", "## Profile", JSON.stringify(view.profile));
    if (view.lecturers.length) out.push("", "## Lecturers", ...view.lecturers.map((l) => `- ${l.name}${l.staffUrl ? ` (${l.staffUrl})` : ""}`));
    const comps = ctx.db.select().from(components).where(eq(components.moduleId, m.id)).all();
    if (comps.length) out.push("", "## Assessment", ...comps.map((c) => `- ${c.name}: ${c.weightPct ?? "?"}%${c.scorePct !== null ? ` · scored ${c.scorePct}%` : ""}`));
    const guide = getStudyGuide(ctx.db, m.id);
    if (guide) out.push("", "## Study guide chapters (read_guide)", ...splitGuideIntoChapters(guide.markdown).chapters.map((c, i) => numbered(c.label, i)));
    const byCat = new Map<string, number>();
    for (const f of ctx.db.select({ c: files.category }).from(files).where(eq(files.moduleId, m.id)).all()) byCat.set(categoryLabel(f.c), (byCat.get(categoryLabel(f.c)) ?? 0) + 1);
    if (byCat.size) out.push("", "## Files (list_files)", [...byCat].map(([c, n]) => `${c}: ${n}`).join(" · "));
    const open = ctx.db.select().from(tasks).where(and(eq(tasks.userId, ctx.userId), eq(tasks.moduleId, m.id), eq(tasks.status, "open"))).all()
      .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
    if (open.length) out.push("", "## Open tasks", ...open.map((t) => `- ${when(t.dueAt)} · ${t.title} (task ${t.id})`));
    const nPages = ctx.db.select({ id: canvasPages.id }).from(canvasPages).where(and(eq(canvasPages.moduleId, m.id), eq(canvasPages.userId, ctx.userId))).all().length;
    const nMsgs = ctx.db.select({ id: canvasMessages.id }).from(canvasMessages).where(and(eq(canvasMessages.moduleId, m.id), eq(canvasMessages.userId, ctx.userId))).all().length;
    const weeks = parseOutline(m.outlineJson)?.length ?? 0;
    if (weeks || nPages || nMsgs) out.push("", `## Also on Canvas`, [weeks ? `Modules tab: ${weeks} sections (course_outline)` : null, nPages ? `${nPages} course pages (read_page)` : null, nMsgs ? `${nMsgs} Inbox messages (list_messages)` : null].filter(Boolean).join(" · "));
    const syllabus = oneLine(htmlToText(m.syllabusBody));
    if (syllabus) out.push("", "## Syllabus page", clip(syllabus, 6000));
    return text(out.join("\n"));
  },
};

const listFiles: Tool<Ctx> = {
  name: "list_files",
  title: "List files",
  description: "The files of one module or all of them — lecture slides, tutorials, assignments, readings, past papers — from Canvas's Files and from links in announcements and pages. Each has an id for read_file and view_page. A name uploaded more than once is listed once, as its newest upload.",
  input: z.object({
    module: moduleArg.optional(),
    category: z.enum(["slides", "tutorial", "assignment", "reading", "practice", "admin", "image", "other"]).optional(),
    name: z.string().optional().describe("Only files whose name contains this"),
  }),
  run(args: { module?: string; category?: string; name?: string }, ctx) {
    const ids = moduleIdsFor(ctx, args.module);
    if (!ids.length) return text("No modules yet.");
    const code = new Map(modulesOf(ctx).map((m) => [m.id, m.code]));
    const all = ctx.db.select().from(files).where(inArray(files.moduleId, ids)).orderBy(desc(files.discoveredAt), desc(files.id)).all();
    const seen = new Set<string>();
    const rows = all.filter((f) => {
      const k = `${f.moduleId}:${f.displayName}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return (!args.category || f.category === args.category) && (!args.name || f.displayName.toLowerCase().includes(args.name.toLowerCase()));
    }).sort((a, b) => (code.get(a.moduleId) ?? "").localeCompare(code.get(b.moduleId) ?? "") || a.displayName.localeCompare(b.displayName, undefined, { numeric: true }));
    if (!rows.length) return text("No files match.");
    const lines = rows.map((f) => {
      const kind = fileKind(f.displayName);
      const readable = kind === "pdf" || kind === "office" || kind === "text" ? "" : kind === "image" ? " · image (read_file shows it)" : " · not readable here";
      return `#${f.id} ${code.get(f.moduleId)} · ${f.displayName} · ${categoryLabel(f.category)} · ${sizeLabel(f.sizeBytes)}${readable}${f.linkedFrom ? ` · linked from "${f.linkedFrom}"` : ""}`;
    });
    return text(part(`${rows.length} files\n${lines.join("\n")}`, 0));
  },
};

const readFile: Tool<Ctx> = {
  name: "read_file",
  title: "Read a file",
  description: "The text of one file. Slides, PDFs, Word, PowerPoint and Excel come page by page (\"--- page N ---\"); plain-text and code files whole; images as the image. A long file comes in parts: ask for a page range, or follow the note at the end. Pages with little text are usually a figure — view_page shows them.",
  input: z.object({
    file_id: z.number().int().describe("From list_files or search"),
    from_page: z.number().int().min(1).optional(),
    to_page: z.number().int().min(1).optional(),
    offset: z.number().int().min(0).optional().describe("For plain-text files: the character to start at"),
  }),
  async run(args: { file_id: number; from_page?: number; to_page?: number; offset?: number }, ctx): Promise<ToolResult> {
    const row = ownedFileById(ctx, args.file_id);
    const name = row.file.displayName;
    const kind = fileKind(name);
    const head = `${row.mod.code} · ${name} (#${row.file.id})`;

    if (kind === "pdf" || kind === "office") {
      const served = await ensurePdf(ctx.db, ctx.userId, row, { convertWaitMs: 90_000 });
      if ("error" in served) throw unopened(served);
      return text(await pdfPages(head, name, served.path, args, "view_page shows it"));
    }

    if (kind === "text") {
      const served = await ensureOriginal(ctx.db, ctx.userId, row);
      if ("error" in served) throw unopened(served);
      return text(`${head}\n\n${part(readFileSync(served.path, "utf8"), args.offset ?? 0)}`);
    }

    if (kind === "image") {
      const type = servedType(name);
      if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(type)) throw new ToolError(`${name} is a ${type} image, which can't be passed on. Open it in OpenPapr.`);
      if ((row.file.sizeBytes ?? 0) > 5_000_000) throw new ToolError(`${name} is ${sizeLabel(row.file.sizeBytes)}, too large to pass on. Open it in OpenPapr.`);
      const served = await ensureOriginal(ctx.db, ctx.userId, row);
      if ("error" in served) throw unopened(served);
      return { content: [{ type: "text", text: head }, { type: "image", data: readFileSync(served.path).toString("base64"), mimeType: type }] };
    }

    throw new ToolError(`${name} is a ${kind === "none" ? "file type" : kind} OpenPapr can't read as text. Open it in OpenPapr or Canvas.`);
  },
};

const viewPage: Tool<Ctx> = {
  name: "view_page",
  title: "View a page",
  description: "One page of a slide deck or other PDF/Office file, as an image — for diagrams, code screenshots, tables and handwriting that the text leaves out.",
  input: z.object({ file_id: z.number().int(), page: z.number().int().min(1) }),
  async run(args: { file_id: number; page: number }, ctx): Promise<ToolResult> {
    const row = ownedFileById(ctx, args.file_id);
    const kind = fileKind(row.file.displayName);
    if (kind !== "pdf" && kind !== "office") throw new ToolError(`${row.file.displayName} has no pages. read_file reads it.`);
    // Rendered at the size the app's slide panel uses, so they share one cached image.
    const res = await renderCachedSlide(ctx.db, ctx.userId, row.mod.id, row.file.displayName, args.page, 2);
    if ("error" in res) throw new ToolError(`Could not draw page ${args.page}: ${res.error}.`);
    return { content: [{ type: "text", text: `${row.mod.code} · ${row.file.displayName} · page ${args.page}` }, { type: "image", data: Buffer.from(res.png).toString("base64"), mimeType: "image/png" }] };
  },
};

// The id a name match's in-app link carries, as the tool that opens it.
const refOf = (href: string) => {
  const file = href.match(/\/files\/(\d+)$/)?.[1];
  const task = href.match(/#task-(\d+)$/)?.[1];
  const item = href.match(/#a-(\d+)$/)?.[1];
  return file ? ` (file_id ${file})` : task ? ` (task ${task})` : item ? ` (item_id ${item})` : "";
};

const searchTool: Tool<Ctx> = {
  name: "search",
  title: "Search",
  description: "Searches the student's material: the words on every page of their lecture slides, tutorials and readings, the study guides, their notes, announcements, assignment and course pages on Canvas and lecturers' Inbox messages (with the passage that matched), plus Canvas work, tasks, files and modules by name. Other files (assignment handouts, past papers) are found by name only — read_file reads them. Use read_file / read_guide / read_item on a hit for more.",
  input: z.object({
    query: z.string().min(1).max(200),
    module: moduleArg.optional(),
    limit: z.number().int().min(1).max(30).optional().describe("Passages to return (default 10)"),
  }),
  async run(args: { query: string; module?: string; limit?: number }, ctx) {
    const mod = args.module ? findModule(ctx, args.module) : null;
    const { hits } = await retrieve(ctx.db, ctx.userId, args.query, { moduleId: mod?.id ?? null, k: args.limit ?? 10 });
    const out: string[] = [];
    for (const h of hits) {
      const ref = h.kind === "slide" ? `read_file file_id=${h.fileId} from_page=${h.page}`
        : h.kind === "guide" ? `read_guide module=${h.code}${h.anchor ? ` (section ${h.anchor})` : ""}`
        : h.kind === "announcement" || h.kind === "assignment" ? `read_item item_id=${h.itemId}`
        : h.kind === "page" ? `read_page page_id=${h.itemId}`
        : h.kind === "message" ? `read_message message_id=${h.itemId}`
        : `read_notes module=${h.code}`;
      out.push(`### ${h.code} · ${h.title}\n→ ${ref}\n${clip(h.body, 900)}`);
    }
    const others = search(ctx.db, ctx.userId, args.query, ctx.now, 30)
      .filter((h) => ["work", "task", "file", "module", "discussion", "reply"].includes(h.kind) && (!mod || h.code === mod.code)).slice(0, 10);
    if (others.length) out.push("## Also matching by name", ...others.map((h) => `- [${h.kind}] ${h.code ?? "—"} · ${h.title}${refOf(h.href)}${h.snippet ? ` — ${oneLine(h.snippet)}` : ""}`));
    return text(out.length ? out.join("\n\n") : `Nothing matches "${args.query}". Try other words, or list_files to browse.`);
  },
};

const readGuide: Tool<Ctx> = {
  name: "read_guide",
  title: "Read a study guide",
  description: "A module's study guide, written by OpenPapr from its slides. Without `chapter`, a short guide comes whole and a long one as its table of contents. Citations look like [slide 12](slide:L3-Heaps#12): the deck is the file name without its extension (list_files name=…), the number is the page.",
  input: z.object({
    module: moduleArg,
    chapter: z.union([z.number().int().min(1), z.string()]).optional().describe("Chapter number, or words from its heading"),
    offset: z.number().int().min(0).optional(),
  }),
  run(args: { module: string; chapter?: number | string; offset?: number }, ctx) {
    const m = findModule(ctx, args.module);
    const guide = getStudyGuide(ctx.db, m.id);
    if (!guide) throw new ToolError(`${m.code} has no study guide yet. It can be generated on the module's page in OpenPapr.`);
    const { preamble, chapters } = splitGuideIntoChapters(guide.markdown);
    const head = `${m.code} study guide · ${guide.sourceNote ?? ""} · written ${sgtDate(guide.generatedAt)}`;
    if (args.chapter === undefined) {
      if (guide.markdown.length <= MAX_CHARS || !chapters.length) return text(`${head}\n\n${part(guide.markdown, args.offset ?? 0)}`);
      return text([head, "", clip(preamble, 3000), "", "## Contents (read_guide chapter=N)",
        ...chapters.map((c, i) => `${numbered(c.label, i)} (${c.markdown.length} chars)${extractSubheadings(c.markdown).map((s) => `\n   - ${s.label}`).join("")}`)].join("\n"));
    }
    const want = String(args.chapter).toLowerCase();
    const idx = typeof args.chapter === "number" ? args.chapter - 1
      : chapters.findIndex((c) => c.label.toLowerCase().includes(want) || slugifyHeading(c.markdown.split("\n")[0]!).includes(slugifyHeading(want)));
    const ch = chapters[idx];
    if (!ch) throw new ToolError(`No chapter "${args.chapter}". It has ${chapters.length}: ${chapters.map((c, i) => numbered(c.label, i)).join("; ")}.`);
    return text(`${head} · chapter ${idx + 1} of ${chapters.length}\n\n${part(ch.markdown, args.offset ?? 0)}`);
  },
};

const ITEM_TYPES = ["announcement", "assignment", "email", "event", "deadline_change", "deadline", "discussion", "staff_reply", "planner_note"] as const;

const listItems: Tool<Ctx> = {
  name: "list_items",
  title: "List announcements, emails and Canvas work",
  description: "Announcements, lecturers' forum replies, assignments and quizzes, discussions, emails (when Outlook is linked) and deadlines, newest first, each with the start of its text. read_item gives one in full.",
  input: z.object({
    module: moduleArg.optional(),
    type: z.enum(ITEM_TYPES).optional(),
    days: z.number().int().min(1).max(400).optional().describe("Only the last N days (default 30); work still due is always included"),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  run(args: { module?: string; type?: (typeof ITEM_TYPES)[number]; days?: number; limit?: number }, ctx) {
    const mod = args.module ? findModule(ctx, args.module) : null;
    const code = new Map(modulesOf(ctx).map((m) => [m.id, m.code]));
    const since = ctx.now - (args.days ?? 30) * D;
    const rows = ctx.db.select().from(items).where(eq(items.userId, ctx.userId)).all()
      .filter((i) => !i.dismissed && (!mod || i.moduleId === mod.id) && (!args.type || i.type === args.type)
        && ((i.sourceCreatedAt ?? i.firstSeenAt) >= since || (i.dueAt !== null && i.dueAt >= ctx.now)))
      .sort((a, b) => (b.sourceCreatedAt ?? b.firstSeenAt) - (a.sourceCreatedAt ?? a.firstSeenAt))
      .slice(0, args.limit ?? 30);
    if (!rows.length) return text("Nothing matches.");
    return text(part(rows.map((i) => {
      const body = oneLine(htmlToText(i.body));
      return `- item ${i.id} · ${i.type} · ${code.get(i.moduleId ?? -1) ?? "—"} · ${when(i.sourceCreatedAt ?? i.firstSeenAt)} · ${i.title}`
        + `${i.sender ? ` · from ${i.sender}` : ""}${i.dueAt ? ` · due ${when(i.dueAt)}` : ""}${i.submitted ? " · submitted" : ""}${markOf(i.gradeJson) ? ` · mark ${markOf(i.gradeJson)}` : ""}`
        + (body ? `\n  ${clip(body, 300)}` : "");
    }).join("\n"), 0));
  },
};

const readItem: Tool<Ctx> = {
  name: "read_item",
  title: "Read an announcement, email or assignment",
  description: "One item from list_items or search, in full. For an assignment: its Canvas page — often the problem statement itself — with its rubric, the files it links to, and its mark and the lecturers' comments once marked. For an email: its attachments.",
  input: z.object({ item_id: z.number().int(), offset: z.number().int().min(0).optional() }),
  run(args: { item_id: number; offset?: number }, ctx) {
    const i = ctx.db.select().from(items).where(and(eq(items.id, args.item_id), eq(items.userId, ctx.userId))).get();
    if (!i) throw new ToolError(`No item ${args.item_id}.`);
    const code = i.moduleId ? modulesOf(ctx).find((m) => m.id === i.moduleId)?.code : null;
    const head = [`# ${i.title}`, `${i.type} · ${code ?? "no module"} · ${when(i.sourceCreatedAt ?? i.firstSeenAt)}${i.sender ? ` · from ${i.sender}` : ""}`,
      i.dueAt ? `Due ${when(i.dueAt)}${i.submitted ? " · submitted" : ""}${i.missing ? " · Canvas marks it missing" : ""}` : null,
      i.url ? `Link: ${i.url}` : null].filter(Boolean).join("\n");
    const g = parse<Grade | null>(i.gradeJson, null);
    const graded = g ? [`\n\n## Mark\n${markOf(i.gradeJson) ?? "not marked yet"}${g.gradedAt ? ` · marked ${when(g.gradedAt)}` : ""}`,
      ...(g.comments.length ? ["\n\n## Comments on the submission", ...g.comments.map((c) => `\n- ${c.author}, ${when(c.at)}: ${c.text}`)] : [])].join("") : "";
    const atts = i.type === "email" ? ctx.db.select().from(mailAttachments).where(and(eq(mailAttachments.itemId, i.id), eq(mailAttachments.userId, ctx.userId))).all() : [];
    const attached = atts.length ? `\n\n## Attachments (read_attachment)\n${atts.map((a) => `- attachment_id ${a.id} · ${a.name} · ${sizeLabel(a.sizeBytes)}${a.path ? "" : " · not kept (too large) — open the email"}`).join("\n")}` : "";
    return text(`${head}\n\n${part(htmlToText(i.body) || "(no text)", args.offset ?? 0)}${graded}${linkedFiles(ctx, i.moduleId, i.body)}${attached}`);
  },
};

type Step = { text: string; minutes: number; doBy: string; done: boolean };
type Source = { kind: string; label: string; deck?: string; page?: number; quote?: string };

const listTasks: Tool<Ctx> = {
  name: "list_tasks",
  title: "List tasks",
  description: "The student's tasks — exams, quizzes, submissions, projects — with due dates (exact or estimated), weight, why OpenPapr thinks so and where it read it, and the study steps planned for each.",
  input: z.object({
    module: moduleArg.optional(),
    status: z.enum(["open", "done", "dismissed", "all"]).optional().describe("Default open"),
  }),
  run(args: { module?: string; status?: "open" | "done" | "dismissed" | "all" }, ctx) {
    const mod = args.module ? findModule(ctx, args.module) : null;
    const code = new Map(modulesOf(ctx).map((m) => [m.id, m.code]));
    const status = args.status ?? "open";
    const rows = ctx.db.select().from(tasks).where(eq(tasks.userId, ctx.userId)).all()
      .filter((t) => (status === "all" || t.status === status) && (!mod || t.moduleId === mod.id))
      .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
    if (!rows.length) return text("No tasks.");
    return text(part(rows.map((t) => {
      const steps = parse<Step[]>(t.stepsJson, []);
      const sources = parse<Source[]>(t.sourcesJson, []);
      return [
        `## ${t.title} (task ${t.id})`,
        `${code.get(t.moduleId ?? -1) ?? "—"} · ${t.kind} · ${t.status} · due ${when(t.dueAt)}${t.dueConfidence === "estimated" ? " (estimated)" : ""}${t.anticipated ? " · expected, not yet announced" : ""}${t.weightPct !== null ? ` · ${t.weightPct}%` : ""}`,
        t.why ? `Why: ${t.why}` : null,
        sources.length ? `From: ${sources.map((s) => `${s.label}${s.deck ? ` (${s.deck}${s.page ? ` p${s.page}` : ""})` : ""}${s.quote ? ` "${clip(s.quote, 160)}"` : ""}`).join("; ")}` : null,
        t.notes ? `Student's notes: ${t.notes}` : null,
        ...steps.map((s) => `- [${s.done ? "x" : " "}] ${s.text} (${s.minutes} min, by ${s.doBy})`),
      ].filter(Boolean).join("\n");
    }).join("\n\n"), 0));
  },
};

const readNotes: Tool<Ctx> = {
  name: "read_notes",
  title: "Read the student's slide notes",
  description: "The notes the student wrote on slides in OpenPapr, by deck and page.",
  input: z.object({ module: moduleArg, deck: z.string().optional().describe("Only this deck (file name without extension)") }),
  run(args: { module: string; deck?: string }, ctx) {
    const m = findModule(ctx, args.module);
    const rows = ctx.db.select().from(slideNotes).where(and(eq(slideNotes.userId, ctx.userId), eq(slideNotes.moduleId, m.id))).all()
      .filter((n) => !args.deck || n.deck.toLowerCase() === args.deck.toLowerCase().replace(/\.[^.]+$/, ""))
      .sort((a, b) => a.deck.localeCompare(b.deck, undefined, { numeric: true }) || a.page - b.page);
    if (!rows.length) return text(`No notes in ${m.code}${args.deck ? ` on ${args.deck}` : ""}.`);
    return text(part(rows.map((n) => `### ${n.deck} · page ${n.page} (${sgtDate(n.updatedAt)})\n${n.markdown}`).join("\n\n"), 0));
  },
};

// --- Canvas: Modules tab, pages, Inbox, email attachments -------------------------

const courseOutline: Tool<Ctx> = {
  name: "course_outline",
  title: "Course outline (Canvas Modules tab)",
  description: "A module's Canvas Modules tab: the lecturer's week-by-week order of the course, with each file (file_id), course page (page_id), assignment (item_id) and outside link — recordings, Zoom, course websites, which are listed with their address but can't be opened here. Ends with the course's pages that aren't in the Modules tab.",
  input: z.object({ module: moduleArg }),
  run(args: { module: string }, ctx) {
    const m = findModule(ctx, args.module);
    const outline = parseOutline(m.outlineJson) ?? [];
    const fileId = new Map(ctx.db.select().from(files).where(eq(files.moduleId, m.id)).orderBy(desc(files.discoveredAt)).all().reverse().map((f) => [f.canvasFileId, f.id]));
    const pages = ctx.db.select().from(canvasPages).where(and(eq(canvasPages.moduleId, m.id), eq(canvasPages.userId, ctx.userId))).all();
    const pageId = new Map(pages.map((p) => [p.pageUrl, p.id]));
    const itemId = new Map(ctx.db.select({ id: items.id, s: items.sourceId }).from(items).where(and(eq(items.userId, ctx.userId), eq(items.moduleId, m.id))).all().map((i) => [i.s, i.id]));
    const ref = (i: OutlineItem): string => {
      switch (i.kind) {
        case "heading": return `**${i.title}**`;
        case "file": { const id = fileId.get(i.canvasFileId ?? -1); return `${i.title}${id ? ` (file_id ${id})` : ""}`; }
        case "page": { const id = pageId.get(i.pageUrl ?? ""); return `Page: ${i.title}${id ? ` (page_id ${id})` : i.locked ? " (locked for you)" : ""}`; }
        case "assignment": { const id = itemId.get(`assignment:${i.contentId}`); return `Assignment: ${i.title}${id ? ` (item_id ${id})` : ""}`; }
        case "discussion": { const id = itemId.get(`discussion:${i.contentId}`); return `Discussion: ${i.title}${id ? ` (item_id ${id})` : ""}`; }
        case "quiz": return `Quiz: ${i.title}`;
        default: return `${i.kind === "tool" ? "Tool" : "Link"}: ${i.title}${i.url ? ` — ${i.url}` : ""}`;
      }
    };
    const out = [`# ${m.code} — course outline`];
    if (!outline.length) out.push("", "This course has no Modules tab (or it is switched off).");
    for (const w of outline) {
      out.push("", `## ${w.name}${w.unlockAt && w.unlockAt > ctx.now ? ` (opens ${when(w.unlockAt)})` : ""}`);
      out.push(...(w.items.length ? w.items.map((i) => `${"  ".repeat(Math.min(i.indent, 4))}- ${ref(i)}${i.locked && i.kind !== "page" ? " (locked for you)" : ""}`) : ["(empty)"]));
    }
    const inOutline = new Set(outline.flatMap((w) => w.items).map((i) => i.pageUrl).filter(Boolean));
    const others = pages.filter((p) => !inOutline.has(p.pageUrl));
    if (others.length) out.push("", "## Other course pages", ...others.map((p) => `- ${p.title} (page_id ${p.id})`));
    return text(part(out.join("\n"), 0));
  },
};

const readPage: Tool<Ctx> = {
  name: "read_page",
  title: "Read a course page",
  description: "One of a course's Canvas pages (from course_outline or search), in full, with the files it links to.",
  input: z.object({ page_id: z.number().int(), offset: z.number().int().min(0).optional() }),
  run(args: { page_id: number; offset?: number }, ctx) {
    const p = ctx.db.select().from(canvasPages).where(and(eq(canvasPages.id, args.page_id), eq(canvasPages.userId, ctx.userId))).get();
    if (!p) throw new ToolError(`No page ${args.page_id}. course_outline lists a module's pages.`);
    const m = modulesOf(ctx).find((x) => x.id === p.moduleId);
    const week = (parseOutline(m?.outlineJson) ?? []).find((w) => w.items.some((i) => i.pageUrl === p.pageUrl))?.name;
    const head = [`# ${p.title}`, `${m?.code ?? ""} · course page${week ? ` · in "${week}"` : ""}${p.updatedAt ? ` · edited ${when(Date.parse(p.updatedAt))}` : ""}`].join("\n");
    return text(`${head}\n\n${part(htmlToText(p.body) || "(no text)", args.offset ?? 0)}${linkedFiles(ctx, p.moduleId, p.body)}`);
  },
};

const listMessages: Tool<Ctx> = {
  name: "list_messages",
  title: "List lecturers' Inbox messages",
  description: "Canvas Inbox messages from the student's lecturers and TAs (and the student's own replies), newest first, past courses included, each with the start of its text. Classmates' messages are not kept. read_message gives a conversation in full.",
  input: z.object({ module: moduleArg.optional(), limit: z.number().int().min(1).max(100).optional() }),
  run(args: { module?: string; limit?: number }, ctx) {
    const mod = args.module ? findModule(ctx, args.module) : null;
    const code = new Map(modulesOf(ctx).map((m) => [m.id, m.code]));
    const rows = ctx.db.select().from(canvasMessages).where(eq(canvasMessages.userId, ctx.userId)).all()
      .filter((r) => !mod || r.moduleId === mod.id).sort((a, b) => b.sentAt - a.sentAt).slice(0, args.limit ?? 30);
    if (!rows.length) return text("No messages from lecturers.");
    return text(part(rows.map((r) => `- message ${r.id} · ${code.get(r.moduleId ?? -1) ?? r.courseName ?? "—"} · ${when(r.sentAt)} · ${r.author}${r.subject ? ` · ${r.subject}` : ""}\n  ${clip(oneLine(r.body), 300)}`).join("\n"), 0));
  },
};

const readMessage: Tool<Ctx> = {
  name: "read_message",
  title: "Read an Inbox conversation",
  description: "The conversation a message from list_messages or search belongs to: every message the lecturers and the student wrote in it, oldest first.",
  input: z.object({ message_id: z.number().int(), offset: z.number().int().min(0).optional() }),
  run(args: { message_id: number; offset?: number }, ctx) {
    const one = ctx.db.select().from(canvasMessages).where(and(eq(canvasMessages.id, args.message_id), eq(canvasMessages.userId, ctx.userId))).get();
    if (!one) throw new ToolError(`No message ${args.message_id}.`);
    const thread = ctx.db.select().from(canvasMessages).where(and(eq(canvasMessages.userId, ctx.userId), eq(canvasMessages.conversationId, one.conversationId))).all()
      .sort((a, b) => a.sentAt - b.sentAt);
    const head = `# ${one.subject ?? "(no subject)"}\n${one.courseName ?? ""}`;
    return text(part(`${head}\n\n${thread.map((r) => `--- ${r.author}, ${when(r.sentAt)} ---\n${r.body}`).join("\n\n")}`, args.offset ?? 0));
  },
};

const readAttachment: Tool<Ctx> = {
  name: "read_attachment",
  title: "Read an email attachment",
  description: "A file attached to an email (read_item lists them): PDFs and Office files page by page, text whole, images as the image.",
  input: z.object({
    attachment_id: z.number().int(),
    from_page: z.number().int().min(1).optional(),
    to_page: z.number().int().min(1).optional(),
    offset: z.number().int().min(0).optional(),
  }),
  async run(args: { attachment_id: number; from_page?: number; to_page?: number; offset?: number }, ctx): Promise<ToolResult> {
    const a = ctx.db.select().from(mailAttachments).where(and(eq(mailAttachments.id, args.attachment_id), eq(mailAttachments.userId, ctx.userId))).get();
    if (!a) throw new ToolError(`No attachment ${args.attachment_id}.`);
    if (!a.path) throw new ToolError(`${a.name} wasn't kept (too large, or it couldn't be downloaded). Open the email in Outlook.`);
    let size: number;
    try { size = statSync(a.path).size; } catch { throw new ToolError(`${a.name}'s copy is gone. Open the email in Outlook.`); }
    const kind = fileKind(a.name);
    const head = `${a.name} (attachment ${a.id})`;
    if (kind === "pdf") return text(await pdfPages(head, a.name, a.path, args, "it may be a figure"));
    if (kind === "office") {
      const served = await officeFileToPdf(a.path, { convertWaitMs: 90_000 });
      if ("error" in served) throw unopened(served);
      return text(await pdfPages(head, a.name, served.path, args, "it may be a figure"));
    }
    if (kind === "text") return text(`${head}\n\n${part(readFileSync(a.path, "utf8"), args.offset ?? 0)}`);
    if (kind === "image") {
      const type = servedType(a.name);
      if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(type) || size > 5_000_000) throw new ToolError(`${a.name} can't be passed on. Open the email in Outlook.`);
      return { content: [{ type: "text", text: head }, { type: "image", data: readFileSync(a.path).toString("base64"), mimeType: type }] };
    }
    throw new ToolError(`${a.name} is a file type OpenPapr can't read as text. Open the email in Outlook.`);
  },
};

export const TOOLS: Tool<Ctx>[] = [overview, listModules, getModule, listFiles, readFile, viewPage, searchTool, readGuide, listItems, readItem, listTasks, readNotes,
  courseOutline, readPage, listMessages, readMessage, readAttachment];

export const INSTRUCTIONS = `OpenPapr is the student's study app: their university modules synced from Canvas (slides, files, announcements, assignments with their marks and feedback — an assignment's problem statement is often only on its Canvas page: read_item; course pages and the Modules tab: course_outline, read_page; lecturers' Inbox messages: list_messages), Outlook email with attachments when linked, study guides written from the slides, their tasks and their own notes. Everything here is read-only.
Start with overview or list_modules. To answer about course content, search first, then read_file (slides, page by page) or read_guide; view_page shows a slide as an image when the figure matters. Cite what you use as module · file name · page. Times are Singapore time.`;
