import { describe, expect, it } from "vitest";
import { acadYearFor, fetchNusmodsModule, fetchReviews, moduleCodes, pickReviews } from "./client";
import { fetchStaffPageText, isNusStaffUrl } from "./staff-page";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("acadYearFor", () => {
  it("starts the academic year in July", () => {
    expect(acadYearFor(Date.UTC(2026, 8, 23))).toBe("2026-2027");
    expect(acadYearFor(Date.UTC(2027, 1, 1))).toBe("2026-2027");
    expect(acadYearFor(Date.UTC(2027, 6, 1))).toBe("2027-2028");
  });
});

describe("moduleCodes", () => {
  it("pulls every NUS code out of a Canvas course code", () => {
    expect(moduleCodes("IFS4103/IS4103")).toEqual(["IFS4103", "IS4103"]);
    expect(moduleCodes("CS2103T [2610]")).toEqual(["CS2103T"]);
    expect(moduleCodes("GEX1015")).toEqual(["GEX1015"]);
    expect(moduleCodes("Orientation 2026")).toEqual([]);
  });
});

describe("fetchNusmodsModule", () => {
  it("falls back to last year when this year has no record", async () => {
    const seen: string[] = [];
    const f = (async (url: string) => {
      seen.push(url);
      return url.includes("2026-2027") ? new Response("", { status: 404 })
        : json({ moduleCode: "CS4238", title: "Computer Security Practice", description: "x", workload: [2, 1, 0, 3, 4], semesterData: [{ semester: 1, examDate: "2025-11-25" }] });
    }) as unknown as typeof fetch;
    const r = await fetchNusmodsModule("CS4238", Date.UTC(2026, 8, 1), f);
    expect(r?.acadYear).toBe("2025-2026");
    expect(r?.module).toMatchObject({ code: "CS4238", workload: [2, 1, 0, 3, 4], semesters: [1], examDates: ["2025-11-25"] });
    expect(seen).toHaveLength(2);
  });
  it("is null when neither year has it", async () => {
    const f = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    expect(await fetchNusmodsModule("ZZ9999", Date.now(), f)).toBeNull();
  });
});

describe("fetchReviews", () => {
  it("pages through, drops deleted, spam and one-liners, and keeps no author", async () => {
    let call = 0;
    const f = (async (url: string) => {
      call++;
      expect(url).toContain("forum=nusmods-prod");
      expect(url).toContain("thread%3Aident=CS4238");
      return call === 1
        ? json({ code: 0, cursor: { hasNext: true, next: "c2" }, response: [
          { raw_message: "Heavy workload but the labs are great practice.", createdAt: "2025-05-01T00:00:00", likes: 3, author: { name: "X" } },
          { raw_message: "spam spam spam spam spam", isSpam: true },
          { raw_message: "ok", createdAt: "2025-01-01" },
        ] })
        : json({ code: 0, cursor: { hasNext: false }, response: [{ raw_message: "Finals were open book, focus on the tutorials.", createdAt: "2024-11-01", isDeleted: false }] });
    }) as unknown as typeof fetch;
    const r = await fetchReviews("CS4238", "key", 150, f);
    expect(r).toEqual([
      { text: "Heavy workload but the labs are great practice.", createdAt: "2025-05-01T00:00:00", likes: 3 },
      { text: "Finals were open book, focus on the tutorials.", createdAt: "2024-11-01", likes: 0 },
    ]);
  });
  it("treats an unknown thread as no reviews", async () => {
    const f = (async () => json({ code: 2, response: "Invalid argument, 'thread': Unable to find thread" }, 400)) as unknown as typeof fetch;
    expect(await fetchReviews("ZZ1000", "key", 150, f)).toEqual([]);
  });
  it("throws on a bad key so the cache is kept", async () => {
    const f = (async () => json({ code: 5, response: "Invalid API key" }, 400)) as unknown as typeof fetch;
    await expect(fetchReviews("CS1010", "bad", 150, f)).rejects.toThrow(/Disqus/);
  });
});

describe("pickReviews", () => {
  it("prefers liked and recent reviews within the budget", () => {
    const now = Date.UTC(2026, 8, 1);
    const picked = pickReviews([
      { text: "a".repeat(500), createdAt: "2019-01-01", likes: 0 },
      { text: "b".repeat(500), createdAt: "2026-05-01", likes: 1 },
      { text: "c".repeat(500), createdAt: "2020-01-01", likes: 20 },
    ], 1000, now);
    expect(picked.map((p) => p.text[0])).toEqual(["c", "b"]);
  });
});

describe("staff pages", () => {
  it("accepts only https nus.edu.sg hosts", () => {
    expect(isNusStaffUrl("https://www.comp.nus.edu.sg/cs/people/someone/")).not.toBeNull();
    expect(isNusStaffUrl("https://nus.edu.sg/x")).not.toBeNull();
    expect(isNusStaffUrl("http://www.comp.nus.edu.sg/x")).toBeNull();
    expect(isNusStaffUrl("https://evilnus.edu.sg/x")).toBeNull();
    expect(isNusStaffUrl("https://nus.edu.sg.evil.com/x")).toBeNull();
    expect(isNusStaffUrl("https://www.comp.nus.edu.sg:8443/x")).toBeNull();
  });
  it("refuses a redirect that leaves NUS", async () => {
    const f = (async () => new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest" } })) as unknown as typeof fetch;
    expect(await fetchStaffPageText("https://www.comp.nus.edu.sg/x", f)).toBeNull();
  });
  it("returns the page as text without navigation", async () => {
    const f = (async () => new Response("<html><nav>Menu Home</nav><h1>Dr A</h1><p>Research: systems security, fuzzing.</p><footer>© NUS</footer></html>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const t = await fetchStaffPageText("https://www.comp.nus.edu.sg/x", f);
    expect(t).toContain("systems security");
    expect(t).not.toContain("Menu");
    expect(t).not.toContain("©");
  });
});
