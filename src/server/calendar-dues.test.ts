import { describe, expect, it } from "vitest";
import { eventTitle } from "./calendar-dues";

const mod = { code: "CS4238", name: "CS4238 Computer Security Practice [2610]" };

describe("eventTitle", () => {
  it("names an event that only repeats the course name a class session", () => {
    expect(eventTitle("CS4238 Computer Security Practice [2610]", mod)).toBe("Class session");
    expect(eventTitle("CS4238", mod)).toBe("Class session");
  });
  it("keeps a real title, without the term tag", () => {
    expect(eventTitle("CTF briefing [2610]", mod)).toBe("CTF briefing");
    expect(eventTitle("Guest talk: red teaming", mod)).toBe("Guest talk: red teaming");
  });
});
