import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { files, modules, passages } from "../db/schema";
import type { CompatConfig } from "../enrich/openai-compat";
import { embedTexts, embeddingsUsable, toBlob } from "../enrich/embeddings";
import { slidePassages, syncCheapSources, syncPassages } from "../server/passages";
import { groupVersions, type DeckSig } from "../lib/deck-versions";
import { fileKind } from "../lib/file-kind";

// Keeps each student's "ask your material" index current: the newest copy of
// every lecture deck and tutorial sheet cut into slide passages (a deck is
// re-read only when it changes), plus the guide, notes and announcements,
// then embeddings for whatever is new, when the provider offers them.

export type IndexDeps = {
  db: Db;
  now: () => number;
  cfgFor: (userId: number) => CompatConfig | null;
  fileText: (userId: number, file: typeof files.$inferSelect, mod: typeof modules.$inferSelect) => Promise<string | null>;
  fetchFn?: typeof fetch;
};

const DECKS_PER_RUN = 2;
const EMBED_BATCH = 32;
const EMBED_PER_RUN = 128;
// A deck that yielded no text is not read again until it changes.
const unreadable = new Set<string>();
const stem = (name: string) => name.replace(/\.[^.]+$/, "");

// What to index: the newest copy of each slide deck and tutorial sheet (as
// the guide writer sees them), and every reading.
type Material = typeof files.$inferSelect & { sig: DeckSig | null; version: string };
export function materialFiles(db: Db, moduleId: number): Material[] {
  const rows = db.select().from(files).where(eq(files.moduleId, moduleId)).all()
    .filter((f) => ["pdf", "office"].includes(fileKind(f.displayName)));
  const sigOf = (f: typeof rows[number]): DeckSig | null => { try { const v = JSON.parse(f.textSigJson ?? "null"); return v && !v.failed ? (v as DeckSig) : null; } catch { return null; } };
  const decks = rows.filter((f) => f.category === "slides" || f.category === "tutorial").map((f) => ({ ...f, sig: sigOf(f) }))
    .filter((f): f is typeof f & { sig: DeckSig } => f.sig !== null && f.sig.words >= 30);
  const out: Material[] = groupVersions(decks).map((g) => ({ ...g.canonical, version: g.canonical.sig.hash }));
  for (const f of rows) if (f.category === "reading") out.push({ ...f, sig: null, version: `r${f.discoveredAt}` });
  return out;
}

export async function indexModule(deps: IndexDeps, userId: number, mod: typeof modules.$inferSelect, budget: { decks: number }): Promise<number> {
  const { db } = deps;
  const now = deps.now();
  let changed = syncCheapSources(db, userId, mod.id, now);

  const current = materialFiles(db, mod.id);
  const keep = new Set(current.map((f) => f.id));
  // Slides from decks that are no longer the newest copy (or are gone) go.
  const stale = db.select({ id: passages.id, fileId: passages.fileId }).from(passages)
    .where(and(eq(passages.moduleId, mod.id), eq(passages.kind, "slide"))).all().filter((r) => r.fileId !== null && !keep.has(r.fileId));
  if (stale.length) { db.delete(passages).where(inArray(passages.id, stale.map((r) => r.id))).run(); changed += stale.length; }

  const versions = new Map(db.select({ fileId: passages.fileId, version: passages.version }).from(passages)
    .where(and(eq(passages.moduleId, mod.id), eq(passages.kind, "slide"))).all().map((r) => [r.fileId, r.version]));
  for (const f of current) {
    if (budget.decks <= 0) break;
    const version = f.version;
    if (versions.get(f.id) === version || unreadable.has(`${f.id}:${version}`)) continue;
    budget.decks--;
    let text: string | null = null;
    try { text = await deps.fileText(userId, f, mod); } catch { text = null; }
    const want = text ? slidePassages(f.id, stem(f.displayName), version, text) : [];
    if (!want.length) { unreadable.add(`${f.id}:${version}`); continue; }
    changed += syncPassages(db, userId, mod.id, `slide:${f.id}:`, want, deps.now());
  }
  return changed;
}

// Embeds passages that have none yet (or one from another model).
export async function embedPending(deps: IndexDeps, userId: number, limit = EMBED_PER_RUN): Promise<number> {
  const cfg = deps.cfgFor(userId);
  const model = embeddingsUsable(cfg);
  if (!cfg || !model) return 0;
  const rows = deps.db.select({ id: passages.id, title: passages.title, body: passages.body }).from(passages)
    .where(and(eq(passages.userId, userId), or(isNull(passages.embedding), isNull(passages.embedModel), ne(passages.embedModel, model))))
    .limit(limit).all();
  let done = 0;
  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const batch = rows.slice(i, i + EMBED_BATCH);
    let vecs: Float32Array[];
    try { vecs = await embedTexts(cfg, model, batch.map((r) => `${r.title}\n${r.body}`), deps.fetchFn); } catch { break; }
    deps.db.transaction((tx) => {
      batch.forEach((r, j) => tx.update(passages).set({ embedding: toBlob(vecs[j]!), embedModel: model }).where(eq(passages.id, r.id)).run());
    });
    done += batch.length;
  }
  return done;
}

export async function indexUser(deps: IndexDeps, userId: number): Promise<{ changed: number; embedded: number }> {
  const mods = deps.db.select().from(modules).where(and(eq(modules.userId, userId), eq(modules.active, true))).all();
  const budget = { decks: DECKS_PER_RUN };
  let changed = 0;
  for (const m of mods) changed += await indexModule(deps, userId, m, budget);
  // Modules dropped from the student's list take their passages with them.
  const ids = mods.map((m) => m.id);
  const orphaned = deps.db.select({ n: sql<number>`count(*)` }).from(passages)
    .where(and(eq(passages.userId, userId), ids.length ? sql`${passages.moduleId} not in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})` : sql`1=1`)).get();
  if (orphaned && orphaned.n > 0) {
    deps.db.delete(passages).where(and(eq(passages.userId, userId), ids.length ? sql`${passages.moduleId} not in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})` : sql`1=1`)).run();
    changed += orphaned.n;
  }
  const embedded = await embedPending(deps, userId);
  return { changed, embedded };
}
