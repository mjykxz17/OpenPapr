import { describe, expect, it } from "vitest";
import { showCanvasLinks } from "./canvas-links";

describe("showCanvasLinks", () => {
  it("links a real student's Canvas course", () => {
    expect(showCanvasLinks({ isDemo: false }, 51234)).toBe(true);
  });
  it("hides the links for the demo account, whose courses are made up", () => {
    expect(showCanvasLinks({ isDemo: true }, 9900001)).toBe(false);
  });
  it("hides them for a module the student made, which has no course", () => {
    expect(showCanvasLinks({ isDemo: false }, 0)).toBe(false);
    expect(showCanvasLinks({ isDemo: false }, -3)).toBe(false);
  });
});
