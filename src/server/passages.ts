import { createHash } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import type { Db } from "@/db/client";
import { items, passages, slideNotes, studyGuides } from "@/db/schema";
import { slidePages } from "@/enrich/study-guide";
import { htmlToText } from "@/lib/html-text";
import { guideSections } from "./search";

// Turns a module's material into passages for "ask your material", and keeps
// the passages table in step with it. Pure builders plus one sync function, so
// the worker and the tests share them.

export type Passage = {
  sourceKey: string; kind: "slide" | "guide" | "note" | "announcement"; version?: string | null;
  fileId?: number | null; deck?: string | null; page?: number | null; itemId?: number | null; anchor?: string | null;
  title: string; body: string;
};

const MAX = 2000;
const clip = (s: string) => (s.length > MAX ? `${s.slice(0, MAX)}…` : s);
const tidy = (s: string) => s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
const passageHash = (p: Passage) => createHash("sha256").update(`${p.title}\n${p.body}`).digest("hex").slice(0, 24);

// One passage per slide page with something to say.
export function slidePassages(fileId: number, deck: string, version: string, deckText: string): Passage[] {
  return slidePages(deckText)
    .map((p) => ({ ...p, text: tidy(p.text) }))
    .filter((p) => p.text.replace(/\s/g, "").length >= 25)
    .map((p) => ({ sourceKey: `slide:${fileId}:${p.page}`, kind: "slide" as const, version, fileId, deck, page: p.page, title: `${deck} · slide ${p.page}`, body: clip(p.text) }));
}

// One per guide section, titled with its chapter so a passage reads on its own.
export function guidePassages(markdown: string): Passage[] {
  const out: Passage[] = [];
  let chapter = "";
  for (const s of guideSections(markdown)) {
    const isChapter = s.level === 2;
    if (isChapter) chapter = s.heading.replace(/^\d+\.\s*/, "");
    if (s.text.length < 40) continue;
    const title = isChapter ? `Guide: ${chapter}` : `Guide: ${chapter} › ${s.heading}`;
    out.push({ sourceKey: `guide:${s.slug}`, kind: "guide", anchor: s.slug, title, body: clip(s.text) });
  }
  // Two sections with one slug: keep the first.
  const seen = new Set<string>();
  return out.filter((p) => (seen.has(p.sourceKey) ? false : (seen.add(p.sourceKey), true)));
}

export function notePassages(rows: { deck: string; page: number; markdown: string }[]): Passage[] {
  return rows.filter((r) => r.markdown.trim().length >= 10).map((r) => ({
    sourceKey: `note:${r.deck}:${r.page}`, kind: "note" as const, deck: r.deck, page: r.page,
    title: `Your note on ${r.deck} · slide ${r.page}`, body: clip(tidy(r.markdown)),
  }));
}

export function announcementPassages(rows: { id: number; type: string; title: string; body: string | null; sender: string | null }[]): Passage[] {
  return rows.map((r) => ({ r, text: tidy(htmlToText(r.body)) })).filter(({ text }) => text.length >= 20).map(({ r, text }) => ({
    sourceKey: `ann:${r.id}`, kind: "announcement" as const, itemId: r.id,
    title: r.type === "staff_reply" ? `${r.sender ?? "Staff"} replied: ${r.title}` : `Announcement: ${r.title}`, body: clip(text),
  }));
}

// Makes the rows under one prefix ("slide:12:", "guide:", …) match `want`:
// new ones added, changed ones rewritten (their embedding dropped), gone ones
// removed. Returns how many rows changed.
export function syncPassages(db: Db, userId: number, moduleId: number, prefix: string, want: Passage[], now: number): number {
  const have = new Map(db.select({ id: passages.id, sourceKey: passages.sourceKey, hash: passages.hash, version: passages.version })
    .from(passages).where(and(eq(passages.moduleId, moduleId), like(passages.sourceKey, `${prefix}%`))).all().map((r) => [r.sourceKey, r]));
  let changed = 0;
  db.transaction((tx) => {
    for (const p of want) {
      const h = passageHash(p);
      const old = have.get(p.sourceKey);
      have.delete(p.sourceKey);
      const row = {
        kind: p.kind, version: p.version ?? null, fileId: p.fileId ?? null, deck: p.deck ?? null, page: p.page ?? null,
        itemId: p.itemId ?? null, anchor: p.anchor ?? null, title: p.title, body: p.body, hash: h, updatedAt: now,
      };
      if (!old) { tx.insert(passages).values({ userId, moduleId, sourceKey: p.sourceKey, ...row }).run(); changed++; }
      else if (old.hash !== h) { tx.update(passages).set({ ...row, embedding: null, embedModel: null }).where(eq(passages.id, old.id)).run(); changed++; }
      else if (old.version !== row.version) tx.update(passages).set({ version: row.version }).where(eq(passages.id, old.id)).run();
    }
    const gone = [...have.values()].map((r) => r.id);
    if (gone.length) { tx.delete(passages).where(inArray(passages.id, gone)).run(); changed += gone.length; }
  });
  return changed;
}

// The cheap sources, rebuilt from the database each time: the guide, the
// student's slide notes, announcements and lecturers' replies.
export function syncCheapSources(db: Db, userId: number, moduleId: number, now: number): number {
  const guide = db.select({ markdown: studyGuides.markdown }).from(studyGuides).where(eq(studyGuides.moduleId, moduleId)).get();
  const notes = db.select().from(slideNotes).where(and(eq(slideNotes.userId, userId), eq(slideNotes.moduleId, moduleId))).all();
  const anns = db.select().from(items).where(and(eq(items.userId, userId), eq(items.moduleId, moduleId))).all()
    .filter((i) => i.type === "announcement" || i.type === "staff_reply");
  return syncPassages(db, userId, moduleId, "guide:", guide ? guidePassages(guide.markdown) : [], now)
    + syncPassages(db, userId, moduleId, "note:", notePassages(notes), now)
    + syncPassages(db, userId, moduleId, "ann:", announcementPassages(anns), now);
}
