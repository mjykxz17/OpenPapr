import { describe, expect, it } from "vitest";
import { noteArrived, noteSeen, noteToSay, noteWaiting } from "./note";

describe("Papi's own lines", () => {
  it("wait as a dot until the student comes to Papi, then say it once", () => {
    const n = noteArrived("Quiz 3 is on Friday");
    expect(noteWaiting(n)).toBe(true);
    expect(noteToSay(n)).toBe("Quiz 3 is on Friday");
    const seen = noteSeen(n);
    expect(noteWaiting(seen)).toBe(false);
    expect(noteToSay(seen)).toBeNull();
    // Still there for the chat to show at the top.
    expect(seen?.text).toBe("Quiz 3 is on Friday");
  });
  it("shows nothing when there is no line", () => {
    expect(noteWaiting(null)).toBe(false);
    expect(noteToSay(null)).toBeNull();
    expect(noteSeen(null)).toBeNull();
  });
});
