import { describe, expect, it, vi } from "vitest";
import { createCompatDeadlineClassifier } from "./classify";

const cfg = { baseUrl: "https://agrouter.example/v1", apiKey: "sk-test", model: "agnes-2.5-flash" };
const chat = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const input = [
  { id: 7, title: "Submit vulnerability report", module: "IFS4103" },
  { id: 8, title: "Bring PC to class", module: "IFS4103" },
];

describe("createCompatDeadlineClassifier", () => {
  it("returns a map of id to category from one batched call", async () => {
    const fetchFn = vi.fn(async () =>
      chat('{"classifications":[{"id":7,"category":"deliverable"},{"id":8,"category":"routine"}]}'));
    const out = await createCompatDeadlineClassifier(cfg, fetchFn as never)(input);
    expect(out).toEqual(new Map([[7, "deliverable"], [8, "routine"]]));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it("defaults ids omitted by the model to deliverable (fail-open, no retry churn)", async () => {
    const fetchFn = vi.fn(async () => chat('{"classifications":[{"id":8,"category":"routine"}]}'));
    const out = await createCompatDeadlineClassifier(cfg, fetchFn as never)(input);
    expect(out!.get(7)).toBe("deliverable");
    expect(out!.get(8)).toBe("routine");
  });
  it("ignores hallucinated ids not in the request", async () => {
    const fetchFn = vi.fn(async () =>
      chat('{"classifications":[{"id":7,"category":"routine"},{"id":999,"category":"routine"}]}'));
    const out = await createCompatDeadlineClassifier(cfg, fetchFn as never)(input);
    expect(out!.has(999)).toBe(false);
  });
  it("returns null on call failure (retry next cycle)", async () => {
    const fetchFn = vi.fn(async () => new Response("x", { status: 500 }));
    expect(await createCompatDeadlineClassifier(cfg, fetchFn as never)(input)).toBeNull();
  });
  it("returns an empty map without calling the LLM when given nothing", async () => {
    const fetchFn = vi.fn();
    expect(await createCompatDeadlineClassifier(cfg, fetchFn as never)([])).toEqual(new Map());
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
