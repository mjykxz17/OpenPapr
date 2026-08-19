import { describe, expect, it, vi } from "vitest";
import { createCanvasClient, isPdfFile } from "./client";

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });

describe("createCanvasClient", () => {
  it("sends bearer auth and hits the courses endpoint", async () => {
    const fetchFn = vi.fn(async () => json([{ id: 1, name: "SE", course_code: "CS2103T" }]));
    const client = createCanvasClient("https://canvas.example", "tok", fetchFn as never);
    const courses = await client.listActiveCourses();
    expect(courses[0].course_code).toBe("CS2103T");
    const [url, init] = (fetchFn.mock.calls[0] as unknown) as [string, RequestInit];
    expect(url).toContain("/api/v1/courses?");
    expect(url).toContain("enrollment_state=active");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
  it("follows Link rel=next pagination and concatenates pages", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json([{ id: 1 }], { link: '<https://canvas.example/api/v1/courses?page=2>; rel="next", <x>; rel="last"' }))
      .mockResolvedValueOnce(json([{ id: 2 }]));
    const client = createCanvasClient("https://canvas.example", "tok", fetchFn as never);
    const courses = await client.listActiveCourses();
    expect(courses.map((c) => c.id)).toEqual([1, 2]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
  it("throws with status and body on non-2xx", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 401 }));
    const client = createCanvasClient("https://canvas.example", "bad", fetchFn as never);
    await expect(client.listActiveCourses()).rejects.toThrow(/401/);
  });
});

describe("listCourseFiles", () => {
  it("lists all course files with pagination params", async () => {
    const fetchFn = vi.fn(async () => json([{ id: 9, display_name: "U0-prelim.pdf", url: "u", "content-type": "application/pdf" }]));
    const client = createCanvasClient("https://canvas.example", "tok", fetchFn as never);
    const files = await client.listCourseFiles(7);
    expect(files[0].display_name).toBe("U0-prelim.pdf");
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toContain("/courses/7/files?per_page=100&sort=created_at");
  });
});

describe("isPdfFile", () => {
  it("matches on the hyphenated content-type key Canvas actually returns", () => {
    expect(isPdfFile({ id: 1, display_name: "deck", url: "u", "content-type": "application/pdf" })).toBe(true);
  });
  it("falls back to the .pdf extension when content-type is absent", () => {
    expect(isPdfFile({ id: 2, display_name: "U0-prelim.pdf", url: "u" })).toBe(true);
  });
  it("rejects non-PDFs", () => {
    expect(isPdfFile({ id: 3, display_name: "course-page-hacking.jpg", url: "u" })).toBe(false);
  });
});
