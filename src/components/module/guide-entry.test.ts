import { describe, expect, it } from "vitest";
import { guideEmptyText, guideEntry } from "./guide-entry";

const none = { hasGuide: false, writing: null, ready: 0, total: 0, canWrite: true };

describe("guideEntry", () => {
  it("offers the filled button only when there is a guide to open", () => {
    expect(guideEntry({ ...none, hasGuide: true })).toMatchObject({ label: "Open study guide", primary: true });
    expect(guideEntry(none).primary).toBe(false);
  });
  it("says the guide writes itself when slides arrive, when nothing is written yet", () => {
    expect(guideEntry(none)).toEqual({
      label: "Guide: writes itself when slides arrive", primary: false, note: "No guide yet · writes itself when slides arrive", tile: "Writes itself as slides arrive",
    });
  });
  // The module page shows the button and the Study guide tile side by side.
  it("gives the tile the same answer as the button", () => {
    expect(guideEntry({ ...none, demo: true }).tile).toBe("Not in the demo");
    expect(guideEntry({ ...none, canWrite: false }).tile).toBe("Needs AI turned on in Account");
    expect(guideEntry({ ...none, writing: "Graphs" }).tile).toBe("Writing “Graphs”");
  });
  it("is honest about work in progress and about a missing AI model", () => {
    expect(guideEntry({ ...none, writing: "Graphs" }).note).toBe("No guide yet · writing “Graphs”");
    expect(guideEntry({ ...none, total: 5, ready: 0 }).note).toBe("No guide yet · 0 of 5 chapters written");
    expect(guideEntry({ ...none, canWrite: false }).label).toBe("Guide: needs AI turned on");
  });
  it("doesn't send a demo visitor to set up AI they can't use", () => {
    expect(guideEntry({ ...none, canWrite: false, demo: true }).label).toBe("Guide: not in the demo");
    expect(guideEntry({ ...none, hasGuide: true, demo: true }).primary).toBe(true);
  });
});

describe("guideEmptyText", () => {
  it("tells a demo visitor the guide isn't coming, like the button does", () => {
    const text = guideEmptyText({ ...none, demo: true });
    expect(text).toMatch(/no guide in the demo/);
    expect(text).not.toMatch(/writes itself/);
  });
  it("matches the button for work in progress and a missing AI model", () => {
    expect(guideEmptyText({ ...none, writing: "Graphs" })).toMatch(/“Graphs” is being written now/);
    expect(guideEmptyText({ ...none, total: 5, ready: 2 })).toMatch(/2 of 5 chapters are written/);
    expect(guideEmptyText({ ...none, canWrite: false })).toMatch(/Once AI is turned on in Account/);
    expect(guideEmptyText(none)).toMatch(/^No guide yet\. It writes itself/);
  });
});
