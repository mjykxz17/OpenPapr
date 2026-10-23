import { describe, expect, it } from "vitest";
import { viewerTakesKey } from "./keys";

const el = (tagName: string, inside: string[] = []) => ({
  tagName, isContentEditable: false,
  closest: (sel: string) => (sel.split(", ").some((s) => s === tagName.toLowerCase() || inside.includes(s)) ? {} : null),
});
const key = (k: string, target: unknown, defaultPrevented = false) => viewerTakesKey({ key: k, target, defaultPrevented });

describe("viewerTakesKey", () => {
  it("turns pages from anywhere on the page", () => {
    expect(key(" ", el("BODY"))).toBe(true);
    expect(key("ArrowRight", el("DIV"))).toBe(true);
    // Arrow keys on a button still turn the page; only pressing it is left to it.
    expect(key("ArrowRight", el("BUTTON"))).toBe(true);
  });

  // Papi sits in the rail on the file viewer: Space on it opens the chat.
  it("leaves Space and Enter to a focused button or link", () => {
    expect(key(" ", el("BUTTON"))).toBe(false);
    expect(key("Enter", el("BUTTON"))).toBe(false);
    expect(key(" ", el("SPAN", ["button"]))).toBe(false);   // the face inside Papi's button
    expect(key(" ", el("DIV", ["[role=button]"]))).toBe(false);
  });

  it("leaves typing, and keys already taken, alone", () => {
    expect(key(" ", el("INPUT"))).toBe(false);
    expect(key("ArrowRight", el("TEXTAREA"))).toBe(false);
    expect(key("ArrowRight", { ...el("DIV"), isContentEditable: true })).toBe(false);
    expect(key("ArrowRight", el("DIV"), true)).toBe(false);
    expect(key(" ", null)).toBe(true);
  });
});
