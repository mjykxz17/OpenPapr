import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACCENTS, isAccent, themeBootScript } from "./theme";

describe("theme", () => {
  it("the boot script accepts exactly the accents the picker offers", () => {
    const m = /\^\(([a-z|]+)\)\$/.exec(themeBootScript);
    expect(m?.[1].split("|").sort()).toEqual(ACCENTS.map((a) => a.name).sort());
  });
  it("every accent has a light and a dark rule in globals.css", () => {
    const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
    for (const a of ACCENTS) {
      expect(css).toContain(`[data-accent="${a.name}"] { --accent: ${a.light}; }`);
      expect(css).toContain(`[data-theme="dark"][data-accent="${a.name}"]`);
      expect(css).toContain(a.dark);
    }
  });
  it("rejects unknown accents", () => {
    expect(isAccent("teal")).toBe(true);
    expect(isAccent("chartreuse")).toBe(false);
  });
});
