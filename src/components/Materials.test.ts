import { describe, expect, it } from "vitest";
import { dedupeMaterials } from "./Materials";

const f = (displayName: string, sizeBytes: number | null, hidden = false) => ({ displayName, sizeBytes, hidden });

describe("dedupeMaterials", () => {
  it("drops a second copy with the same name and size, keeping the Files-tab one", () => {
    const rows = [f("U3-memerr3.pdf", 556_000, true), f("U3-memerr3.pdf", 556_000, false), f("U3-memerr2.pdf", 82_000)];
    expect(dedupeMaterials(rows)).toEqual([f("U3-memerr3.pdf", 556_000, false), f("U3-memerr2.pdf", 82_000)]);
  });
  it("keeps same-named files of different sizes — a revised handout is a different file", () => {
    const rows = [f("lab1.pdf", 100), f("lab1.pdf", 200)];
    expect(dedupeMaterials(rows)).toHaveLength(2);
  });
});
