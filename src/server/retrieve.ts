import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { modules, passages } from "@/db/schema";
import type { CompatConfig } from "@/enrich/openai-compat";
import { dot, embedTexts, embeddingsUsable, fromBlob } from "@/enrich/embeddings";

// Finds the passages of the student's material that answer a question: word
// matching (BM25) and, when the provider has embeddings, meaning matching,
// merged by rank. Small enough to run in memory per question.

export type Hit = {
  id: number; kind: "slide" | "guide" | "note" | "announcement"; moduleId: number; code: string;
  title: string; body: string; fileId: number | null; deck: string | null; page: number | null; itemId: number | null; anchor: string | null;
};

const STOP = new Set("a an and are as at be but by can do does for from has have how i in is it its me my of on or so that the their there this to was what when where which who why will with you your about into than then them these they".split(" "));
export const tokens = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !STOP.has(t));

type Doc = { id: number; tf: Map<string, number>; len: number };

// Okapi BM25 over the given docs; returns ids ranked best first.
export function bm25(query: string[], docs: Doc[], limit = 40): { id: number; score: number }[] {
  if (!query.length || !docs.length) return [];
  const avg = docs.reduce((n, d) => n + d.len, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const q of new Set(query)) df.set(q, docs.reduce((n, d) => n + (d.tf.has(q) ? 1 : 0), 0));
  const k1 = 1.2, b = 0.75, N = docs.length;
  const out: { id: number; score: number }[] = [];
  for (const d of docs) {
    let s = 0;
    for (const q of new Set(query)) {
      const f = d.tf.get(q);
      if (!f) continue;
      const n = df.get(q)!;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / avg));
    }
    if (s > 0) out.push({ id: d.id, score: s });
  }
  return out.sort((a, b2) => b2.score - a.score).slice(0, limit);
}

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

export async function retrieve(
  db: Db, userId: number, question: string,
  opts: { moduleId?: number | null; cfg?: CompatConfig | null; k?: number; fetchFn?: typeof fetch } = {},
): Promise<{ hits: Hit[]; semantic: boolean; total: number }> {
  const where = opts.moduleId ? and(eq(passages.userId, userId), eq(passages.moduleId, opts.moduleId)) : eq(passages.userId, userId);
  const rows = db.select().from(passages).where(where).all();
  if (!rows.length) return { hits: [], semantic: false, total: 0 };
  const byId = new Map(rows.map((r) => [r.id, r]));

  const lexical = bm25(tokens(question), docsFor(rows, `${userId}:${opts.moduleId ?? "all"}`)).map((h) => h.id);

  let semantic: number[] = [];
  const model = embeddingsUsable(opts.cfg ?? null);
  if (model && opts.cfg && rows.some((r) => r.embedModel === model && r.embedding)) {
    try {
      const [q] = await embedTexts(opts.cfg, model, [question], opts.fetchFn);
      semantic = rows.filter((r) => r.embedModel === model && r.embedding)
        .map((r) => ({ id: r.id, s: dot(q!, fromBlob(r.embedding!)) }))
        .sort((a, b) => b.s - a.s).slice(0, 40).filter((x) => x.s > 0.15).map((x) => x.id);
    } catch { semantic = []; }
  }

  const ranked = semantic.length ? fuse([lexical, semantic]) : lexical;
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
