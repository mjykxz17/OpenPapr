// Lecturers post the same slides more than once: a colour deck and its
// black-and-white print copy, "U3-memerr1-to-S39" before the full
// "U3-memerr1", a corrected re-upload under the same name, "…_2026" beside
// last year's. A guide should be written from one copy — the most complete,
// newest — so decks are grouped by what they say, not by what they are called.

const SHINGLE = 4;
const HASHES = 64;

export type DeckSig = {
  pages: number;
  words: number;
  head: string;          // the first slides' text, for the planner to read
  minhash: number[];     // HASHES values; similar text → similar values
  hash: string;          // exact content, so an identical re-upload changes nothing
};

function fnv(s: string, seed: number): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

export function deckSignature(text: string): DeckSig {
  const pages = Number(text.match(/--\s*\d+\s*of\s*(\d+)\s*--/)?.[1] ?? 0);
  const body = text.replace(/--\s*\d+\s*of\s*\d+\s*--/g, " ").toLowerCase();
  const words = body.match(/[a-z0-9]+/g) ?? [];
  const mins = new Array<number>(HASHES).fill(0xffffffff);
  for (let i = 0; i + SHINGLE <= words.length; i++) {
    const sh = words.slice(i, i + SHINGLE).join(" ");
    for (let k = 0; k < HASHES; k++) { const h = fnv(sh, k * 2654435761); if (h < mins[k]) mins[k] = h; }
  }
  const head = text.replace(/--\s*\d+\s*of\s*\d+\s*--/g, " | ").replace(/\s+/g, " ").trim().slice(0, 400);
  return { pages, words: words.length, head, minhash: words.length >= SHINGLE ? mins : [], hash: fnv(body.replace(/\s+/g, " "), 7).toString(36) + words.length.toString(36) };
}

// Estimated share of 4-word runs the two decks have in common.
export function similarity(a: DeckSig, b: DeckSig): number {
  if (!a.minhash.length || !b.minhash.length) return 0;
  let same = 0;
  for (let k = 0; k < HASHES; k++) if (a.minhash[k] === b.minhash[k]) same++;
  return same / HASHES;
}

// A name with its version marks taken off: "IFS4103-Lect-1-v1-BW-3.pdf",
// "IFS4103-Lect-1-v1-3.pdf" → "ifs4103-lect-1"; "U3-memerr1-to-S39.pdf" →
// "u3-memerr1"; "Guide_2026.pdf" → "guide".
export function baseName(name: string): string {
  return name.toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[\s_]*\(\d+\)$/, "")
    .replace(/[-_\s]*(to|upto|until)[-_\s]*s?\d+$/, "")
    .replace(/[-_\s]*(v\d+(?:[-_.]\d+)*|bw|b&w|grey|gray|annotated|updated?|final|new|copy|print|handout|draft|revised|ay\d{2,4}|20\d{2})(?=$|[-_\s])/g, "")
    .replace(/[-_\s]+$/, "")
    .trim();
}

export type VersionFile = { id: number; displayName: string; discoveredAt: number; sig: DeckSig | null };
export type VersionGroup<T extends VersionFile> = { canonical: T; others: T[] };

const BW_RE = /(^|[-_\s])(bw|b&w|grey|gray|print)([-_\s.]|$)/i;

// Same deck when the text largely overlaps, or when the names match after
// version marks come off and the text does not clearly disagree. Within a
// group the copy to read is the fullest (most slides, so "-to-S39" loses),
// then colour over black-and-white, then the newest upload.
export function groupVersions<T extends VersionFile>(rows: T[], threshold = 0.55): VersionGroup<T>[] {
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j];
    const sim = a.sig && b.sig ? similarity(a.sig, b.sig) : null;
    const sameName = baseName(a.displayName) === baseName(b.displayName);
    // A partial copy shares most of its text with the full one but not the
    // other way round, so a lower bar applies when the names agree.
    if ((sim !== null && sim >= threshold) || (sameName && (sim === null || sim >= 0.2))) parent[find(i)] = find(j);
  }
  const groups = new Map<number, T[]>();
  rows.forEach((r, i) => { const g = find(i); groups.set(g, [...(groups.get(g) ?? []), r]); });
  return [...groups.values()].map((members) => {
    // Clearly fuller wins (a "-to-S39" part loses to the whole deck); about
    // the same size, colour beats black-and-white and newer beats older, so
    // a corrected re-upload replaces the copy it corrects.
    const ranked = [...members].sort((a, b) => {
      const pa = a.sig?.pages ?? 0, pb = b.sig?.pages ?? 0;
      if (Math.abs(pa - pb) > 0.15 * Math.max(pa, pb)) return pb - pa;
      return Number(BW_RE.test(a.displayName)) - Number(BW_RE.test(b.displayName))
        || b.discoveredAt - a.discoveredAt
        || b.id - a.id;
    });
    return { canonical: ranked[0], others: ranked.slice(1) };
  });
}
