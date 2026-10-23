import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { files, items, modules, studyGuides, tasks } from "@/db/schema";
import { htmlToText } from "@/lib/html-text";
import { slugifyHeading } from "@/lib/study-chapters";

// One box for everything: guide sections, announcements and what lecturers
// said in the forums, Canvas work, tasks, files and modules. Plain word
// matching in memory — a student's whole semester is a few thousand rows, so
// this is quick, and it needs no index to keep in step.

export type SearchKind = "guide" | "announcement" | "reply" | "discussion" | "work" | "task" | "file" | "module";
export type SearchHit = {
  kind: SearchKind; title: string; snippet: string; href: string; external: boolean;
  code: string | null; at: number | null; score: number;
};

type Doc = Omit<SearchHit, "score" | "snippet"> & { text: string; boost: number };

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
export const terms = (q: string) => [...new Set(norm(q).split(/[^a-z0-9]+/).filter((t) => t.length >= 2 || /\d/.test(t)))].slice(0, 8);

// Markdown to the words a reader sees: no slide links, figures, diagrams or emphasis marks.
export function plainMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\((?:slide|slide-img):[^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// A guide as sections: each ## chapter and each ### inside it, with the text
// under that heading up to the next one.
export function guideSections(markdown: string): { heading: string; slug: string; text: string; level: 2 | 3 }[] {
  const out: { heading: string; slug: string; text: string; level: 2 | 3 }[] = [];
  let cur: { heading: string; slug: string; lines: string[]; level: 2 | 3 } | null = null;
  let fence = false;
  const flush = () => { if (cur) out.push({ heading: cur.heading, slug: cur.slug, text: plainMarkdown(cur.lines.join("\n")), level: cur.level }); };
  for (const line of markdown.split("\n")) {
    if (/^```/.test(line)) fence = !fence;
    const m = !fence ? /^(##|###) (?!#)(.+)$/.exec(line) : null;
    if (m) { flush(); const h = m[2]!.trim(); cur = { heading: h.replace(/\*\*/g, ""), slug: slugifyHeading(h), lines: [], level: m[1] === "##" ? 2 : 3 }; continue; }
    cur?.lines.push(line);
  }
  flush();
  return out;
}

// The stretch of text around the first match, so the student sees why it matched.
export function snippet(text: string, words: string[], width = 160): string {
  const lower = norm(text);
  let at = -1;
  for (const w of words) { const i = lower.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0 || text.length <= width) return text.slice(0, width) + (text.length > width ? "…" : "");
  const start = Math.max(0, at - Math.floor(width / 3));
  const piece = text.slice(start, start + width);
  return `${start > 0 ? "…" : ""}${piece.replace(/^\S*\s/, start > 0 ? "" : "$&")}${start + width < text.length ? "…" : ""}`;
}

// Guides are long and change rarely: split once per version.
const guideCache = new Map<number, { at: number; sections: ReturnType<typeof guideSections> }>();

function collect(db: Db, userId: number): Doc[] {
  const mods = db.select().from(modules).where(and(eq(modules.userId, userId), eq(modules.active, true))).all();
  const byId = new Map(mods.map((m) => [m.id, m]));
  const ids = mods.map((m) => m.id);
  const docs: Doc[] = [];

  for (const m of mods) {
    docs.push({ kind: "module", title: `${m.code} ${m.name}`, text: m.name, href: `/modules/${m.id}`, external: false, code: m.code, at: null, boost: 2 });
  }

  if (ids.length) {
    for (const g of db.select().from(studyGuides).where(inArray(studyGuides.moduleId, ids)).all()) {
      let cached = guideCache.get(g.moduleId);
      if (!cached || cached.at !== g.generatedAt) { cached = { at: g.generatedAt, sections: guideSections(g.markdown) }; guideCache.set(g.moduleId, cached); }
      for (const s of cached.sections) {
        docs.push({ kind: "guide", title: s.heading.replace(/^\d+\.\s*/, ""), text: s.text, href: `/modules/${g.moduleId}/guide#${s.slug}`, external: false, code: byId.get(g.moduleId)?.code ?? null, at: g.generatedAt, boost: 1.2 });
      }
    }
    for (const f of db.select().from(files).where(inArray(files.moduleId, ids)).all()) {
      docs.push({ kind: "file", title: f.displayName, text: f.linkedFrom ?? "", href: `/modules/${f.moduleId}/files/${f.id}`, external: false, code: byId.get(f.moduleId)?.code ?? null, at: f.discoveredAt, boost: 1 });
    }
  }

  const rows = db.select().from(items).where(eq(items.userId, userId)).all().filter((r) => r.source === "canvas" && (r.moduleId === null || byId.has(r.moduleId)));
  const bySource = new Map(rows.map((r) => [r.sourceId, r]));
  for (const r of rows) {
    const code = r.moduleId ? byId.get(r.moduleId)?.code ?? null : null;
    const modHref = r.moduleId ? `/modules/${r.moduleId}` : "/tasks";
    const body = htmlToText(r.body).replace(/\s+/g, " ").slice(0, 4000);
    const at = r.sourceCreatedAt ?? r.firstSeenAt;
    if (r.type === "announcement") docs.push({ kind: "announcement", title: r.title, text: body, href: `${modHref}#a-${r.id}`, external: false, code, at, boost: 1.1 });
    else if (r.type === "staff_reply") {
      let topic: typeof r | undefined;
      try { topic = bySource.get((JSON.parse(r.metaJson ?? "{}") as { topicSourceId?: string }).topicSourceId ?? ""); } catch { topic = undefined; }
      docs.push({ kind: "reply", title: `${r.sender ?? "Staff"}: ${topic?.title ?? r.title}`, text: body, href: topic ? `${modHref}#a-${topic.id}` : r.url ?? modHref, external: !topic && Boolean(r.url), code, at, boost: 1.1 });
    } else if (r.type === "discussion") docs.push({ kind: "discussion", title: r.title, text: body, href: `${modHref}#a-${r.id}`, external: false, code, at, boost: 0.9 });
    else if (r.type === "assignment" || r.type === "deadline" || r.type === "planner_note" || r.type === "event") {
      if (r.dismissed) continue;
      docs.push({ kind: "work", title: r.title, text: body, href: r.url ?? modHref, external: Boolean(r.url), code, at: r.dueAt ?? at, boost: 1 });
    }
  }

  for (const t of db.select().from(tasks).where(eq(tasks.userId, userId)).all()) {
    if (t.status === "dismissed") continue;
    const steps = (() => { try { return (JSON.parse(t.stepsJson) as { text: string }[]).map((s) => s.text).join(" · "); } catch { return ""; } })();
    docs.push({ kind: "task", title: t.title, text: [t.why, steps].filter(Boolean).join(" — "), href: `/tasks#task-${t.id}`, external: false, code: t.moduleId ? byId.get(t.moduleId)?.code ?? null : null, at: t.dueAt, boost: t.status === "open" ? 1.3 : 0.6 });
  }
  return docs;
}

// --- spelling ------------------------------------------------------------------
// Course notes are written in British or American English, and students type
// fast. Words are compared in one spelling (American, the shorter one), and a
// word nobody wrote at all gets matched to the nearest word that is there.

// Word endings that differ only by spelling. Each side of a comparison goes
// through the same rules, so a rule that also fires on an unrelated word
// (exercise → exercize) is harmless as long as it never turns one real word
// into another; the stems are long enough that "rise", "four" and "hour" stay.
const SPELLING: [RegExp, string | ((...m: string[]) => string)][] = [
  [/(\w{3,})isation(s|al|ally)?$/, "$1ization$2"],
  [/(\w{3,})is(e|es|ed|er|ers|ing)$/, "$1iz$2"],
  [/(\w{2,})ys(e|es|ed|er|ers|ing)$/, "$1yz$2"],
  [/(\w{2,})our(s|ed|ing|ite|ites|able|ful|less|er|ers)?$/, "$1or$2"],
  // centre/center, centres/centers, centred/centered
  [/(\w{2,}[tbgv])re(s|d)?$/, (_, stem: string, end?: string) => `${stem}er${end === "d" ? "ed" : end ?? ""}`],
  [/(\w{3,})ell(ing|ed|er|ers)$/, "$1el$2"],
];
// -ce / -se only for the nouns where it is the same word.
const CE: Record<string, string> = { defence: "defense", licence: "license", offence: "offense", pretence: "pretense", practise: "practice", practised: "practiced", practising: "practicing" };

const canonCache = new Map<string, string>();
export function canonical(word: string): string {
  const hit = canonCache.get(word);
  if (hit !== undefined) return hit;
  let w = CE[word] ?? word;
  if (w.length >= 5 && !/\d/.test(w)) for (const [re, to] of SPELLING) w = typeof to === "string" ? w.replace(re, to) : w.replace(re, to);
  if (canonCache.size > 50_000) canonCache.clear();
  canonCache.set(word, w);
  return w;
}

// Levenshtein distance, giving up once it is past `max`.
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]!);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

// The words a term may stand for, beyond itself: the same word in the other
// spelling ("amortised" for "amortized", "colours" for "colour"), and — only
// when nothing has the word as typed — words one typo away (two for long words).
export type TermForms = { term: string; forms: string[]; fuzzy: boolean };
export function termForms(term: string, words: string[]): TermForms {
  const c = canonical(term);
  const forms = new Set<string>();
  let seen = false;
  for (const v of words) {
    if (v.includes(term)) { seen = true; continue; }
    if (canonical(v).startsWith(c)) forms.add(v);
  }
  if (seen || forms.size || term.length < 5 || /\d/.test(term)) return { term, forms: [...forms], fuzzy: false };
  const max = term.length >= 8 ? 2 : 1;
  const near = words.filter((v) => v.length >= 4 && editDistance(c, canonical(v), max) <= max);
  return { term, forms: near, fuzzy: near.length > 0 };
}

const wordsOf = (s: string) => s.split(/[^a-z0-9]+/).filter(Boolean);

// Words a file name has that say nothing about which file it is.
const GENERIC = new Set(["the", "and", "for", "with", "from", "notes", "note", "lecture", "lec", "slides", "slide", "week", "pdf", "docx", "pptx", "file", "tutorial", "tut", "chapter", "part"]);

export function search(db: Db, userId: number, query: string, now: number, limit = 30): SearchHit[] {
  const words = terms(query);
  if (!words.length) return [];
  const phrase = norm(query.trim());
  const docs = collect(db, userId).map((d) => {
    const title = norm(d.title);
    return { d, title, all: `${title} ${norm(d.code ?? "")} ${norm(d.text)}` };
  });
  const vocab = new Set<string>();
  for (const x of docs) for (const w of wordsOf(x.all)) vocab.add(w);
  const known = [...vocab];
  const expanded = words.map((w) => termForms(w, known));
  const hits: SearchHit[] = [];
  for (const { d, title, all } of docs) {
    // Per term: the form this doc has (the term itself first), or null.
    const found = expanded.map((t) => (all.includes(t.term) ? t.term : t.forms.find((f) => all.includes(f)) ?? null));
    const matched = found.filter((f): f is string => f !== null);
    let partial = 1;
    if (matched.length < words.length) {
      // A file is found by its name even when the rest of the query is about
      // what is in it ("master theorem" → L4-master.pdf): its name has to
      // carry a real word of the query, not just "4" or "notes".
      if (d.kind !== "file" || !matched.some((f) => title.includes(f) && f.length >= 4 && !/^\d+$/.test(f) && !GENERIC.has(f))) continue;
      partial = 0.5 * (matched.length / words.length);
    }
    let score = 0;
    found.forEach((w, i) => {
      if (!w) return;
      let s = 0;
      if (title.includes(w)) s += 3;
      if (new RegExp(`\\b${w}`).test(all)) s += 1;
      // More mentions, more about it — with a ceiling, so a long section does not swamp.
      s += Math.min(3, all.split(w).length - 1) * 0.3;
      // The word as typed beats its other spelling, which beats a typo's guess.
      score += w === expanded[i]!.term ? s : expanded[i]!.fuzzy ? s * 0.7 : s * 0.9;
    });
    if (phrase.length > 3 && all.includes(phrase)) score += 4;
    if (title === phrase || norm(d.code ?? "") === phrase) score += 6;
    // Newer is likelier what they want, within a semester.
    if (d.at) score += Math.max(0, 1 - Math.abs(now - d.at) / (120 * 86_400_000));
    hits.push({ kind: d.kind, title: d.title, snippet: snippet(d.text, matched), href: d.href, external: d.external, code: d.code, at: d.at, score: score * d.boost * partial });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
