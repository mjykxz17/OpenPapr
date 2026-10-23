import { describe, expect, it } from "vitest";
import { bubbleBox, dockBottom, panelBox, petRect, RAIL_W, TAB_BAR_H } from "./placement";

// The rail's free stretch at 1440×900: below the nav icons, above Account.
const dock = { left: 0, top: 360, width: RAIL_W, height: 380 };
const desktop = { w: 1440, h: 900 };
const phoneVw = { w: 390, h: 844 };
const tab = { left: 234, top: 784, width: 78, height: 60 };

describe("dockBottom", () => {
  it("keeps Papi inside its stretch of the rail, wherever it was dragged", () => {
    expect(dockBottom(0, 380, 52)).toBe(0);
    expect(dockBottom(-200, 380, 52)).toBe(0);
    expect(dockBottom(10_000, 380, 52)).toBe(328);
    expect(dockBottom(120, 380, 52)).toBe(120);
  });
  it("sits at the bottom when the window is too short to give it room, or the saved spot is junk", () => {
    expect(dockBottom(80, 30, 52)).toBe(0);
    expect(dockBottom(Number.NaN, 380, 52)).toBe(0);
  });
});

describe("petRect", () => {
  it("centres Papi in the rail, never past its edge", () => {
    const pet = petRect(false, dock, 0, 48, 52);
    expect(pet.left).toBe(4);
    expect(pet.left + pet.width).toBeLessThanOrEqual(RAIL_W);
    expect(pet.top + pet.height).toBe(dock.top + dock.height);
  });
  it("is the tab itself on a phone", () => {
    expect(petRect(true, tab, 0, 34, 37)).toEqual(tab);
  });
});

describe("panelBox", () => {
  it("opens the chat beside the rail, not over it, level with Papi", () => {
    const pet = petRect(false, dock, 0, 48, 52);
    const box = panelBox(false, pet, desktop, { w: 380, h: 500 });
    expect(box.left).toBeGreaterThanOrEqual(RAIL_W);
    expect(box.top + box.height).toBe(pet.top + pet.height);
    expect(box.width).toBe(380);
  });
  it("stays on screen in a small window", () => {
    const small = { w: 700, h: 420 };
    const pet = petRect(false, { ...dock, top: 200, height: 100 }, 80, 48, 52);
    const box = panelBox(false, pet, small, { w: 900, h: 800 });
    expect(box.top).toBeGreaterThanOrEqual(8);
    expect(box.top + box.height).toBeLessThanOrEqual(small.h - 8);
    expect(box.left + box.width).toBeLessThanOrEqual(small.w - 8);
  });
  it("is a sheet above the tab bar on a phone", () => {
    const box = panelBox(true, tab, phoneVw, { w: 380, h: 500 });
    expect(box.left).toBe(8);
    expect(box.width).toBe(phoneVw.w - 16);
    expect(box.top + box.height).toBe(phoneVw.h - TAB_BAR_H);
  });
});

describe("bubbleBox", () => {
  it("speaks from beside the rail on a wide screen", () => {
    const pet = petRect(false, dock, 0, 48, 52);
    const b = bubbleBox(false, pet, desktop);
    expect(b.left).toBe(RAIL_W + 8);
    expect(b.bottom).toBe(desktop.h - (dock.top + dock.height));
  });
  it("sits above the tab on a phone, leaning towards the middle", () => {
    const right = bubbleBox(true, tab, phoneVw);
    expect(right.bottom).toBe(phoneVw.h - tab.top + 6);
    expect(right.right).toBe(phoneVw.w - (tab.left + tab.width));
    const left = bubbleBox(true, { ...tab, left: 4 }, phoneVw);
    expect(left.left).toBe(8);
  });
});
