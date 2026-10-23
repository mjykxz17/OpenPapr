import { describe, expect, it } from "vitest";
import { demoBannerBootScript, hideDemoBanner } from "./demo-banner-state";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

// Runs the inline boot script against a stand-in <html> and sessionStorage.
function boot(store: unknown) {
  const html = { dataset: {} as Record<string, string> };
  new Function("document", "sessionStorage", demoBannerBootScript)({ documentElement: html }, store);
  return html.dataset;
}

describe("demo banner", () => {
  it("shows until put away, then is hidden before paint for the rest of the visit", () => {
    const s = memory();
    expect(boot(s).demoBanner).toBeUndefined();
    hideDemoBanner(s);
    expect(boot(s).demoBanner).toBe("hidden");
  });
  it("shows when storage is missing or throws", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(() => hideDemoBanner(null)).not.toThrow();
    expect(() => hideDemoBanner(broken)).not.toThrow();
    expect(boot(broken).demoBanner).toBeUndefined();
    expect(boot(undefined).demoBanner).toBeUndefined();
  });
});
