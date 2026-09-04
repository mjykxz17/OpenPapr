import { describe, expect, it } from "vitest";
import { moduleDisplay } from "./module-display";

describe("moduleDisplay", () => {
  it("strips the code and the term suffix Canvas puts in the course name", () => {
    expect(moduleDisplay({ code: "CS4238", name: "CS4238 Computer Security Practice [2610]" }))
      .toEqual({ title: "Computer Security Practice", termCode: "2610" });
  });

  it("copes with a name that carries neither", () => {
    expect(moduleDisplay({ code: "TPC", name: "Teaching Practice Community" }))
      .toEqual({ title: "Teaching Practice Community", termCode: null });
  });

  it("falls back to the full name when stripping would leave nothing", () => {
    expect(moduleDisplay({ code: "CS4238", name: "CS4238" })).toEqual({ title: "CS4238", termCode: null });
  });
});
