import { describe, expect, it, vi } from "vitest";
import { fetchInboxDelta } from "./client";

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });

describe("fetchInboxDelta", () => {
  it("starts from the base delta URL when deltaLink is null and follows nextLink", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json({ value: [{ id: "m1", subject: "a" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/next" }))
      .mockResolvedValueOnce(json({ value: [{ id: "m2", subject: "b" }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?token=T" }));
    const out = await fetchInboxDelta("tok", null, fetchFn as never);
    expect(out.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(out.deltaLink).toContain("token=T");
    expect(((fetchFn.mock.calls[0] as unknown as [unknown])[0] as string)).toContain("/me/mailFolders/inbox/messages/delta");
  });
  it("resumes from a stored deltaLink", async () => {
    const fetchFn = vi.fn(async () => json({ value: [], "@odata.deltaLink": "https://d2" }));
    await fetchInboxDelta("tok", "https://d1", fetchFn as never);
    expect(((fetchFn.mock.calls[0] as unknown as [unknown])[0] as string)).toBe("https://d1");
  });
  it("throws on 401 so the worker can surface reconnect", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(fetchInboxDelta("tok", null, fetchFn as never)).rejects.toThrow(/401/);
  });
});
