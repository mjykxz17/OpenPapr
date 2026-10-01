import type { Hit } from "./retrieve";

// Turning retrieved passages into numbered sources for the model, and the
// model's [n] citations back into links the student can open.

export type SourceRef = {
  n: number; kind: Hit["kind"]; title: string; code: string; moduleId: number; href: string;
  slide: { deck: string; page: number } | null;
};

export const SOURCES_RULES = `SOURCES are passages from the student's own slides, study guides, notes and course announcements, numbered [1], [2], …
- For questions about course content, answer from SOURCES. Put the source number in square brackets right after the sentence it supports, like "A canary sits before the return address [2]." Cite only numbers that are listed.
- If SOURCES and FACTS don't cover the question, say that their material doesn't seem to cover it, and suggest where to look. Never fill gaps from general knowledge without saying so.
- For a content question you may use up to 6 short sentences or a short list.`;

export function sourcesBlock(hits: Hit[]): string {
  return hits.map((h, i) => `[${i + 1}] ${h.code ? `${h.code} · ` : ""}${h.title}\n${h.body.replace(/\s+/g, " ").slice(0, 1200)}`).join("\n\n");
}

export function sourceHref(h: Pick<Hit, "kind" | "moduleId" | "deck" | "page" | "anchor" | "itemId">): string {
  const m = `/modules/${h.moduleId}`;
  if ((h.kind === "slide" || h.kind === "note") && h.deck && h.page) return `${m}/guide?slide=${encodeURIComponent(h.deck)}&page=${h.page}`;
  if (h.kind === "guide" && h.anchor) return `${m}/guide#${h.anchor}`;
  if (h.kind === "announcement" && h.itemId) return `${m}#a-${h.itemId}`;
  return m;
}

// The sources the answer actually cites, in the order they were numbered.
// Citations to numbers that were never given are dropped from the text.
export function citedSources(reply: string, hits: Hit[]): { text: string; sources: SourceRef[] } {
  const used = new Set<number>();
  const text = reply.replace(/\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g, (whole, inner: string) => {
    const nums = inner.split(/\s*,\s*/).flatMap((part) => {
      const r = /^(\d+)\s*[–-]\s*(\d+)$/.exec(part);
      if (r) { const a = Number(r[1]), b = Number(r[2]); return b >= a && b - a < 10 ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : []; }
      return [Number(part)];
    }).filter((n) => n >= 1 && n <= hits.length);
    if (!nums.length) return "";
    nums.forEach((n) => used.add(n));
    return nums.map((n) => `[${n}]`).join("");
  }).replace(/\s+([.,;:])/g, "$1");
  const sources = [...used].sort((a, b) => a - b).map((n) => {
    const h = hits[n - 1]!;
    return { n, kind: h.kind, title: h.title, code: h.code, moduleId: h.moduleId, href: sourceHref(h), slide: (h.kind === "slide" || h.kind === "note") && h.deck && h.page ? { deck: h.deck, page: h.page } : null };
  });
  return { text, sources };
}
