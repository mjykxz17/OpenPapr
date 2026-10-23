// The words on a slide-citation chip, made from where the chip leads, so the
// label and the slide it opens can never disagree. The guide's own link text
// ("[L1 p20](slide:L1-asymptotics#18)") is not trusted for this.

const PREFIX: Record<string, string> = {
  lecture: "L", lec: "L", week: "W", wk: "W", tutorial: "T", tut: "T", unit: "U", chapter: "Ch", ch: "Ch", lab: "Lab ", topic: "Topic ",
};

// A short name for a deck: its "L1"-style code when it has one
// ("L1-asymptotics", "CS2040S-L3"), "L5" for "Lecture 5 - Paging", or else its
// first word, clipped.
export function shortDeck(deck: string): string {
  const words = deck.trim().split(/[\s_.\-–]+/).filter(Boolean);
  const code = words.find((w) => /^[A-Za-z]{1,2}\d{1,2}[a-z]?$/.test(w));
  if (code) return code;
  const named = /\b(lecture|lec|week|wk|tutorial|tut|unit|chapter|ch|lab|topic)\s*[-_]?\s*(\d+)/i.exec(deck);
  if (named) return `${PREFIX[named[1]!.toLowerCase()]}${named[2]}`;
  const first = words[0] ?? deck;
  return first.length > 12 ? `${first.slice(0, 11)}…` : first;
}

export const slideChipLabel = (deck: string, page: number) => `${shortDeck(deck)} p${page}`;
