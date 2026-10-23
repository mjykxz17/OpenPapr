import { createHash } from "node:crypto";
import { decodeDeck } from "./slide-citation";

// A study guide is a preamble followed by one "## N. Title" chapter per
// lecture deck. Chapters are told apart by the deck their slide citations
// point at, which lets one chapter be regenerated without touching the rest.

export type Chapter = { deck: string | null; markdown: string };

const CHAPTER_RE = /^## \d+\.\s/m;

// The deck a chapter was written from: the one its citations name most often.
export function chapterDeck(markdown: string): string | null {
  const counts = new Map<string, number>();
  for (const m of markdown.matchAll(/\]\(slide(?:-img)?:([^#)]+)#\d+\)/g)) {
    const d = decodeDeck(m[1]!);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best: string | null = null, n = 0;
  for (const [d, c] of counts) if (c > n) { best = d; n = c; }
  return best;
}

export function splitChapters(markdown: string): { preamble: string; chapters: Chapter[] } {
  const lines = markdown.split("\n");
  const starts: number[] = [];
  let inFence = false;
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) inFence = !inFence;
    else if (!inFence && CHAPTER_RE.test(l)) starts.push(i);
  });
  if (starts.length === 0) return { preamble: markdown.trim(), chapters: [] };
  const preamble = lines.slice(0, starts[0]).join("\n").trim();
  const chapters = starts.map((s, k) => {
    const md = lines.slice(s, starts[k + 1] ?? lines.length).join("\n").trim();
    return { deck: chapterDeck(md), markdown: md };
  });
  return { preamble, chapters };
}

// Renumbers "## N." chapters and their "### N.M" sections to match the new
// order, leaving everything inside code fences alone.
export function renumber(chapters: Chapter[]): Chapter[] {
  return chapters.map((c, i) => {
    let inFence = false;
    const md = c.markdown.split("\n").map((l) => {
      if (/^\s*```/.test(l)) { inFence = !inFence; return l; }
      if (inFence) return l;
      return l.replace(/^## \d+\.(\s)/, `## ${i + 1}.$1`).replace(/^### \d+\.(\d+)(\s)/, `### ${i + 1}.$1$2`);
    }).join("\n");
    return { ...c, markdown: md };
  });
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

// New chapters replace the old chapter for the same deck; every other old
// chapter stays. Chapters are kept in deck-name order, which for lectures is
// teaching order ("L2" before "L10").
export function mergeChapters(existing: Chapter[], fresh: Chapter[]): Chapter[] {
  const freshDecks = new Set(fresh.map((c) => c.deck).filter(Boolean));
  const kept = existing.filter((c) => !c.deck || !freshDecks.has(c.deck));
  const all = [...kept, ...fresh];
  const withDeck = all.filter((c) => c.deck).sort((a, b) => natural(a.deck!, b.deck!));
  const without = all.filter((c) => !c.deck);
  return renumber([...withDeck, ...without]);
}

export function assembleGuide(preamble: string, chapters: Chapter[]): string {
  return [preamble.trim(), ...chapters.map((c) => c.markdown.trim())].filter(Boolean).join("\n\n");
}

// What a chapter teaches, without what the guide wraps it in: the "## N."
// heading, the "Counts toward" line, lecturer notes and status notes above
// the first section all go, and "### 4.2" reads "### 1.2" again. For an
// automatic chapter this is exactly the body written from its slides.
export function chapterBody(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").trim().split("\n");
  let i = /^## /.test(lines[0] ?? "") ? 1 : 0;
  while (i < lines.length && (lines[i]!.trim() === "" || /^\s*>/.test(lines[i]!))) i++;
  let inFence = false;
  return lines.slice(i).map((l) => {
    if (/^\s*```/.test(l)) { inFence = !inFence; return l; }
    return inFence ? l : l.replace(/^### \d+\.(\d+)(\s)/, "### 1.$1$2");
  }).join("\n").trim();
}

// The key a chapter's practice quiz (guide_quizzes) and the answers given to
// it (quiz_attempts) are stored under. It depends on the slide-written body
// only, so handing in an assessment, a new lecturer note or a reordered
// guide leaves the quiz and its history alone; a rewritten chapter gets a
// new one.
export const chapterHash = (markdown: string): string =>
  createHash("sha256").update(chapterBody(markdown)).digest("hex").slice(0, 32);
