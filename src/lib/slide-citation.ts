// Study-guide slide citations are authored as markdown links with a custom
// `slide:` scheme — e.g. [slide 62](slide:U0-prelim#62) — where the deck stem
// is the source PDF's filename without extension and the number is the page.
export function parseSlideCitation(href: string): { deck: string; page: number } | null {
  const m = /^slide:(.+)#(\d+)$/.exec(href);
  if (!m) return null;
  return { deck: m[1], page: Number(m[2]) };
}

// Link that opens the deck PDF (proxied from Canvas) at the cited page. The
// #page=N fragment is honoured by the browser's built-in PDF viewer.
export function deckProxyUrl(moduleId: number, deck: string, page: number): string {
  return `/api/modules/${moduleId}/deck?name=${encodeURIComponent(deck)}#page=${page}`;
}

// An embedded slide figure is authored as a markdown image with a `slide-img:`
// scheme — ![caption](slide-img:U2-background#15) — which renders as an image
// of that slide page (rendered on demand from the deck PDF).
export function parseSlideImage(src: string): { deck: string; page: number } | null {
  const m = /^slide-img:(.+)#(\d+)$/.exec(src);
  if (!m) return null;
  return { deck: m[1], page: Number(m[2]) };
}

export function slideImageUrl(moduleId: number, deck: string, page: number, size: "full" | "thumb" = "full"): string {
  return `/api/modules/${moduleId}/slide?name=${encodeURIComponent(deck)}&page=${page}${size === "thumb" ? "&size=thumb" : ""}`;
}

// Every page each deck is cited on, across a whole guide — the slide panel
// marks these in its filmstrip. Matches the same `slide:deck#N` links the
// renderer turns into chips.
export function citedPagesByDeck(markdown: string): Record<string, number[]> {
  const out: Record<string, Set<number>> = {};
  for (const m of markdown.matchAll(/\]\(slide:([^)#\s]+)#(\d+)\)/g)) {
    (out[m[1]] ??= new Set()).add(Number(m[2]));
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].sort((a, b) => a - b)]));
}
