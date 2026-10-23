import { describe, expect, it } from "vitest";
import { demoBannerHidden, hideDemoBanner } from "./demo-banner-state";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("demo banner", () => {
  it("shows until put away, then stays away for the visit", () => {
    const s = memory();
    expect(demoBannerHidden(s)).toBe(false);
    hideDemoBanner(s);
    expect(demoBannerHidden(s)).toBe(true);
  });
  it("shows when storage is missing or throws", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(demoBannerHidden(null)).toBe(false);
    expect(() => hideDemoBanner(broken)).not.toThrow();
    expect(demoBannerHidden(broken)).toBe(false);
  });
});
