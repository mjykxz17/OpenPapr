import { describe, expect, it } from "vitest";
import { detectModuleCodes, triageEmail } from "./rules";

const ctx = { activeCodes: ["CS2103T", "ST2334"] };
const mail = (over: Partial<Parameters<typeof triageEmail>[0]>) =>
  triageEmail({ sender: "x@nus.edu.sg", title: "hello", body: "", moduleId: null, ...over }, ctx);

describe("detectModuleCodes", () => {
  it("finds NUS-style codes, deduplicated", () => {
    expect(detectModuleCodes("CS2103T and ST2334 and CS2103T")).toEqual(["CS2103T", "ST2334"]);
  });
  it("ignores lowercase and random words", () => {
    expect(detectModuleCodes("cs2103t hello ABC12")).toEqual([]);
  });
});

describe("triageEmail", () => {
  it("marks module-linked mail important", () => {
    expect(mail({ title: "CS2103T tutorial swap" }).verdict).toBe("important");
  });
  it("marks urgent-keyword mail important", () => {
    expect(mail({ title: "Reminder: S/U deadline 20 Aug" }).verdict).toBe("important");
  });
  it("marks newsletters garbage", () => {
    expect(mail({ sender: "noreply@events.nus.edu.sg", body: "Click unsubscribe to stop" }).verdict).toBe("garbage");
  });
  it("important outranks bulk markers (fail-open)", () => {
    expect(mail({ title: "ST2334 quiz", body: "unsubscribe" }).verdict).toBe("important");
  });
  it("defaults to ambiguous", () => {
    expect(mail({ title: "Lunch?" }).verdict).toBe("ambiguous");
  });
  it("every verdict carries a reason", () => {
    expect(mail({ title: "Lunch?" }).reason.length).toBeGreaterThan(0);
  });
});
