import { describe, expect, it } from "vitest";
import { todayLine } from "./today-line";

describe("todayLine", () => {
  it("says there are no deadlines, not that nothing is due, on a free day", () => {
    expect(todayLine(0)).toBe("No deadlines today");
    expect(todayLine(0)).not.toMatch(/nothing/i);
  });
  it("counts deadlines, singular and plural", () => {
    expect(todayLine(1)).toBe("1 deadline today");
    expect(todayLine(3)).toBe("3 deadlines today");
  });
});
