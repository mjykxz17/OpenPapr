import { describe, expect, it } from "vitest";
import { shortComponentName, shortModuleName } from "./module-name";

describe("module names", () => {
  it("drops the code, cross-listed codes and the term id", () => {
    expect(shortModuleName("CS4239", "CS4239/CS5439 Software Security [2610]")).toBe("Software Security");
    expect(shortModuleName("GEC1044", "GEC1044 Chinese Medicine: Theory and Practice [2610]")).toBe("Chinese Medicine: Theory and Practice");
    expect(shortModuleName("CS2103T", "CS2103T Software Engineering")).toBe("Software Engineering");
    expect(shortModuleName("ST2334", "Probability and Statistics")).toBe("Probability and Statistics");
    expect(shortModuleName("TPC", "TPC")).toBe("TPC");
  });
  it("drops asides and codes from component names", () => {
    expect(shortComponentName("Group Field Work (Medicine Hall) (CA3)")).toBe("Group Field Work");
    expect(shortComponentName("Quizzes")).toBe("Quizzes");
    expect(shortComponentName("(CA1)")).toBe("(CA1)");
  });
});
