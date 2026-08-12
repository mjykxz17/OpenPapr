import { describe, expect, it } from "vitest";
import { linkMailToModule, normalizeMail } from "./normalize";

const msg = {
  id: "AAMk1", subject: "CS2103T midterm venue", bodyPreview: "moved to MPSH2",
  webLink: "https://outlook.example/1", receivedDateTime: "2026-08-12T03:02:00Z",
  from: { emailAddress: { name: "Prof Tan", address: "tankl@nus.edu.sg" } },
};

describe("normalizeMail", () => {
  it("maps graph fields", () => {
    const m = normalizeMail(msg);
    expect(m).toEqual({
      sourceId: "mail:AAMk1", title: "CS2103T midterm venue", body: "moved to MPSH2",
      url: "https://outlook.example/1", sender: "tankl@nus.edu.sg",
      sourceCreatedAt: Date.parse("2026-08-12T03:02:00Z"), moduleId: null,
    });
  });
  it("tolerates null subject", () => {
    expect(normalizeMail({ ...msg, subject: null }).title).toBe("(no subject)");
  });
});

describe("linkMailToModule", () => {
  const byCode = new Map([["CS2103T", 42], ["ST2334", 43]]);
  it("links by code in the subject", () => {
    expect(linkMailToModule(normalizeMail(msg), byCode).moduleId).toBe(42);
  });
  it("leaves unknown codes unlinked", () => {
    const m = normalizeMail({ ...msg, subject: "EC1301 briefing", bodyPreview: "" });
    expect(linkMailToModule(m, byCode).moduleId).toBeNull();
  });
});
