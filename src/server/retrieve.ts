import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { modules, passages } from "@/db/schema";
import type { CompatConfig } from "@/enrich/openai-compat";
import { dot, embedTexts, embeddingsUsable, fromBlob } from "@/enrich/embeddings";

// Finds the passages of the student's material that answer a question: word
// matching (BM25) and, when the provider has embeddings, meaning matching,
// merged by rank. Small enough to run in memory per question.

export type Hit = {
  id: number; kind: "slide" | "guide" | "note" | "announcement" | "assignment" | "page" | "message"; moduleId: number; code: string;
  title: string; body: string; fileId: number | null; deck: string | null; page: number | null; itemId: number | null; anchor: string | null;
};

const STOP = new Set("a an and are as at be but by can do does for from has have how i in is it its me my of on or so that the their there this to was what when where which who why will with you your about into than then them these they".split(" "));
// Plurals fold onto their singular, so "canaries" finds "canary".
const stem = (t: string) =>
  t.length <= 3 ? t
  : t.endsWith("ies") ? `${t.slice(0, -3)}y`
  : /(sses|shes|ches|xes)$/.test(t) ? t.slice(0, -2)
  : t.endsWith("s") && !/(ss|us|is)$/.test(t) ? t.slice(0, -1)
  : t;
export const tokens = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !STOP.has(t)).map(stem);

// Words that say how to answer rather than what about: "explain", "give an
// example". They would otherwise count against a passage that does not repeat them.
const ASKING = new Set("explain describe define definition meaning mean tell give show example please pls papi understand help know work use used using idea concept thing simple simply word again more detail summarise summarize summary quick quickly briefly lecture".split(" ").map(stem));
export const queryTokens = (s: string) => tokens(s).filter((t) => !ASKING.has(t));

type Doc = { id: number; tf: Map<string, number>; len: number };

// Okapi BM25 over the given docs; returns ids ranked best first. `cover` is
// the share of the question's weight (the idf of the `must` words, the whole
// query by default) that the passage contains, so a passage that only shares
// one common word with the question can be told apart from one about it.
export function bm25(query: string[], docs: Doc[], limit = 40, must: string[] = query): { id: number; score: number; cover: number }[] {
  if (!query.length || !docs.length) return [];
  const avg = docs.reduce((n, d) => n + d.len, 0) / docs.length || 1;
  const terms = new Set([...query, ...must]);
  const k1 = 1.2, b = 0.75, N = docs.length;
  const idf = new Map<string, number>();
  for (const q of terms) {
    const n = docs.reduce((c, d) => c + (d.tf.has(q) ? 1 : 0), 0);
    idf.set(q, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  }
  const mustSet = new Set(must);
  const mustWeight = [...mustSet].reduce((w, q) => w + idf.get(q)!, 0) || 1;
  const out: { id: number; score: number; cover: number }[] = [];
  for (const d of docs) {
    let s = 0;
    for (const q of new Set(query)) {
      const f = d.tf.get(q);
      if (!f) continue;
      s += idf.get(q)! * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / avg));
    }
    let covered = 0;
    for (const q of mustSet) if (d.tf.has(q)) covered += idf.get(q)!;
    if (s > 0) out.push({ id: d.id, score: s, cover: covered / mustWeight });
  }
  return out.sort((a, b2) => b2.score - a.score).slice(0, limit);
}

// The relevance floor. A word match counts only when the passage holds at
// least half of what the question is about (by idf weight): "capital of
// France" no longer finds a slide on capital letters. Calibrated on the
// fixtures in ask-material.test.ts.
export const LEXICAL_FLOOR = 0.5;

// Meaning matches below this are noise. Each embedding model spreads its
// scores differently, so the floor is per model; unrelated text sits under it.
const SEMANTIC_FLOORS: [RegExp, number][] = [
  [/text-embedding-3/i, 0.3], [/ada-002/i, 0.78], [/mistral-embed/i, 0.72], [/bge/i, 0.6], [/e5/i, 0.8], [/nomic/i, 0.5],
];
export const semanticFloor = (model: string) => SEMANTIC_FLOORS.find(([re]) => re.test(model))?.[1] ?? 0.3;

// Reciprocal rank fusion: a passage near the top of either list rises.
export function fuse(lists: number[][], k = 60): number[] {
  const score = new Map<number, number>();
  for (const list of lists) list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

// Tokenised passages per user, rebuilt only when their rows change.
const cache = new Map<string, { sig: string; docs: Doc[] }>();
function docsFor(rows: { id: number; title: string; body: string; updatedAt: number }[], key: string): Doc[] {
  const sig = `${rows.length}:${rows.reduce((m, r) => Math.max(m, r.updatedAt), 0)}:${rows.reduce((m, r) => Math.max(m, r.id), 0)}`;
  const hit = cache.get(key);
  if (hit && hit.sig === sig) return hit.docs;
  const docs = rows.map((r) => {
    const t = tokens(`${r.title} ${r.title} ${r.body}`);
    const tf = new Map<string, number>();
    for (const x of t) tf.set(x, (tf.get(x) ?? 0) + 1);
    return { id: r.id, tf, len: t.length };
  });
  cache.set(key, { sig, docs });
  return docs;
}

// The guide is OpenPapr's own writing about the slides, so it gives way to
// them: each guide passage drops this many places and loses ties. A guide
// passage well ahead of everything else still makes the list; one level with
// a slide on the same point goes under it.
export const GUIDE_DEMOTION = 3;
export function demoteGuide(ids: number[], isGuide: (id: number) => boolean): number[] {
  const place = new Map(ids.map((id, i) => [id, isGuide(id) ? i + GUIDE_DEMOTION + 0.5 : i]));
  return [...ids].sort((a, b) => place.get(a)! - place.get(b)!);
}

// `context` is the student's previous question, given when the new one is a
// short follow-up ("why?", "and heap spraying?"): it steers the ranking, but
// the new question's own words (or, for meaning matches, the new question on
// its own) still have to clear the floor for a passage to count.
export async function retrieve(
  db: Db, userId: number, question: string,
  opts: { moduleId?: number | null; cfg?: CompatConfig | null; k?: number; fetchFn?: typeof fetch; context?: string | null } = {},
): Promise<{ hits: Hit[]; semantic: boolean; total: number }> {
  const where = opts.moduleId ? and(eq(passages.userId, userId), eq(passages.moduleId, opts.moduleId)) : eq(passages.userId, userId);
  const rows = db.select().from(passages).where(where).all();
  if (!rows.length) return { hits: [], semantic: false, total: 0 };
  const byId = new Map(rows.map((r) => [r.id, r]));

  const own = queryTokens(question);
  const ctx = opts.context ? queryTokens(opts.context) : [];
  // A follow-up with no words of its own ("why?") is about the previous question.
  const must = own.length ? own : ctx;
  const lexical = bm25([...own, ...ctx], docsFor(rows, `${userId}:${opts.moduleId ?? "all"}`), 40, must)
    .filter((h) => h.cover >= LEXICAL_FLOOR).map((h) => h.id);

  let semantic: number[] = [];
  const model = embeddingsUsable(opts.cfg ?? null);
  if (model && opts.cfg && rows.some((r) => r.embedModel === model && r.embedding)) {
    try {
      // With a follow-up, two vectors: the question alone decides what clears
      // the floor, the question with its context decides the order. Only a
      // follow-up with no subject of its own ("why?") is judged with its context.
      const texts = opts.context
        ? (own.length ? [question, `${opts.context}\n${question}`] : [`${opts.context}\n${question}`])
        : [question];
      const vecs = await embedTexts(opts.cfg, model, texts, opts.fetchFn);
      const gate = vecs[0]!, steer = vecs[vecs.length - 1]!;
      const floor = semanticFloor(model);
      semantic = rows.filter((r) => r.embedModel === model && r.embedding)
        .map((r) => { const v = fromBlob(r.embedding!); return { id: r.id, gate: dot(gate, v), s: gate === steer ? 0 : dot(steer, v) }; })
        .filter((x) => x.gate >= floor).sort((a, b) => (b.s - a.s) || (b.gate - a.gate)).slice(0, 40).map((x) => x.id);
    } catch { semantic = []; }
  }

  const fused = semantic.length ? fuse([lexical, semantic]) : lexical;
  const ranked = demoteGuide(fused, (id) => byId.get(id)!.kind === "guide");
  const codes = new Map(db.select({ id: modules.id, code: modules.code }).from(modules).where(eq(modules.userId, userId)).all().map((m) => [m.id, m.code]));
  // No more than three passages from one deck, so an answer can draw on more than one source.
  const perSource = new Map<string, number>();
  const hits: Hit[] = [];
  for (const id of ranked) {
    const r = byId.get(id)!;
    const src = r.fileId ? `f${r.fileId}` : r.kind;
    if ((perSource.get(src) ?? 0) >= 3) continue;
    perSource.set(src, (perSource.get(src) ?? 0) + 1);
    hits.push({ id: r.id, kind: r.kind, moduleId: r.moduleId, code: codes.get(r.moduleId) ?? "", title: r.title, body: r.body, fileId: r.fileId, deck: r.deck, page: r.page, itemId: r.itemId, anchor: r.anchor });
    if (hits.length >= (opts.k ?? 8)) break;
  }
  return { hits, semantic: semantic.length > 0, total: rows.length };
}
