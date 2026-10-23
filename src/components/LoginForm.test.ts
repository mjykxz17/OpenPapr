import { describe, expect, it } from "vitest";
import { tabKeyTarget } from "./LoginForm";

// The Sign in / First time tabs follow the ARIA tabs pattern: arrows move
// between them (and wrap), Home and End jump to the ends.
describe("sign-in tabs keyboard", () => {
  it("moves with the arrow keys and wraps", () => {
    expect(tabKeyTarget("ArrowRight", "signin")).toBe("setup");
    expect(tabKeyTarget("ArrowRight", "setup")).toBe("signin");
    expect(tabKeyTarget("ArrowLeft", "signin")).toBe("setup");
    expect(tabKeyTarget("ArrowLeft", "setup")).toBe("signin");
  });

  it("jumps to the first and last tab with Home and End", () => {
    expect(tabKeyTarget("Home", "setup")).toBe("signin");
    expect(tabKeyTarget("End", "signin")).toBe("setup");
  });

  it("leaves every other key alone", () => {
    for (const k of ["Enter", " ", "Tab", "a", "ArrowDown"]) expect(tabKeyTarget(k, "signin")).toBeNull();
  });
});
