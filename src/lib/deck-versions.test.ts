import { describe, expect, it } from "vitest";
import { baseName, deckSignature, groupVersions, similarity } from "./deck-versions";

const deck = (pages: string[]) => pages.map((p, i) => `-- ${i + 1} of ${pages.length} --\n${p}`).join("\n");
// Pseudo-random slide text, seeded by topic, so two topics share almost nothing.
const lorem = (topic: string, n: number) => {
  let x = [...topic].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const word = () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return `w${x % 5000}`; };
  return Array.from({ length: n }, () => Array.from({ length: 18 }, word).join(" "));
};

describe("deck versions", () => {
  it("strips version marks from names", () => {
    expect(baseName("IFS4103-Lect-1-v1-3.pdf")).toBe("ifs4103-lect-1");
    expect(baseName("U3-memerr1-to-S39.pdf")).toBe("u3-memerr1");
    expect(baseName("Group Fieldwork- A Simple Guide_2026.pdf")).toBe(baseName("Group Fieldwork- A Simple Guide.pdf"));
    expect(baseName("IFS4103-Lect-2-v1-2.pdf")).not.toBe(baseName("IFS4103-Lect-1-v1-3.pdf"));
  });
  it("measures overlap", () => {
    const a = deckSignature(deck(lorem("buffer", 30)));
    const b = deckSignature(deck(lorem("buffer", 30)));
    const c = deckSignature(deck(lorem("fuzzing", 30)));
    expect(similarity(a, b)).toBe(1);
    expect(similarity(a, c)).toBeLessThan(0.2);
    expect(a.pages).toBe(30);
  });
  it("keeps the fullest, colour, newest copy", () => {
    const full = deckSignature(deck(lorem("heap", 60)));
    const part = deckSignature(deck(lorem("heap", 39)));
    const other = deckSignature(deck(lorem("format string", 40)));
    const groups = groupVersions([
      { id: 1, displayName: "U3-memerr1-to-S39.pdf", discoveredAt: 1, sig: part },
      { id: 2, displayName: "U3-memerr1.pdf", discoveredAt: 2, sig: full },
      { id: 3, displayName: "U3-memerr2.pdf", discoveredAt: 2, sig: other },
      { id: 4, displayName: "L1-v1-BW.pdf", discoveredAt: 5, sig: deckSignature(deck(lorem("intro", 20))) },
      { id: 5, displayName: "L1-v1.pdf", discoveredAt: 5, sig: deckSignature(deck(lorem("intro", 20))) },
      { id: 6, displayName: "U3-memerr3.pdf", discoveredAt: 3, sig: deckSignature(deck(lorem("race", 25))) },
      { id: 7, displayName: "U3-memerr3.pdf", discoveredAt: 9, sig: deckSignature(deck([...lorem("race", 24), "a corrected slide about races and locks"])) },
    ]);
    const canon = groups.map((g) => g.canonical.id).sort();
    expect(canon).toEqual([2, 3, 5, 7]);
    expect(groups.find((g) => g.canonical.id === 2)!.others.map((o) => o.id)).toEqual([1]);
  });
});
