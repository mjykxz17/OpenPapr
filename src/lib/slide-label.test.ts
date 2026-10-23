import { describe, expect, it } from "vitest";
import { shortDeck, slideChipLabel } from "./slide-label";

describe("slide chip labels", () => {
  it("names the slide the chip opens, whatever the link text said", () => {
    // The guide wrote "[L1 p20](slide:L1-asymptotics#18)": the chip says p18.
    expect(slideChipLabel("L1-asymptotics", 18)).toBe("L1 p18");
  });
  it("shortens deck names", () => {
    expect(shortDeck("U0-prelim")).toBe("U0");
    expect(shortDeck("CS2040S-L3-sorting")).toBe("L3");
    expect(shortDeck("Lecture 5 - Paging")).toBe("L5");
    expect(shortDeck("Tutorial_2")).toBe("T2");
    expect(shortDeck("CS2040S_Lecture_10")).toBe("L10");
    expect(shortDeck("CS2040S_Tutorial_3_sorting")).toBe("T3");
    expect(shortDeck("Week10 notes")).toBe("W10");
    expect(shortDeck("Introductions-and-setup")).toBe("Introductio…");
    expect(shortDeck("Intro")).toBe("Intro");
  });
});
