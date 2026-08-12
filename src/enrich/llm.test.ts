import { describe, expect, it, vi } from "vitest";
import { createScorer } from "./llm";

const mkClient = (impl: () => Promise<unknown>) =>
  ({ messages: { parse: vi.fn(impl) } }) as never;
const mail = { sender: "reg@nus.edu.sg", title: "S/U closes", body: "20 Aug" };

describe("createScorer", () => {
  it("maps a high score to important", async () => {
    const client = mkClient(async () => ({ parsed_output: { important: true, score: 0.9, reason: "registrar deadline" } }));
    expect(await createScorer(client, "claude-haiku-4-5")(mail)).toEqual({ triage: "important", importance: 0.9, reason: "registrar deadline" });
  });
  it("maps a low score to garbage", async () => {
    const client = mkClient(async () => ({ parsed_output: { important: false, score: 0.05, reason: "promo blast" } }));
    expect((await createScorer(client, "m")(mail)).triage).toBe("garbage");
  });
  it("maps mid scores to ambiguous (shown)", async () => {
    const client = mkClient(async () => ({ parsed_output: { important: false, score: 0.4, reason: "unclear" } }));
    expect((await createScorer(client, "m")(mail)).triage).toBe("ambiguous");
  });
  it("fails open on SDK errors", async () => {
    const client = mkClient(async () => { throw new Error("529"); });
    expect(await createScorer(client, "m")(mail)).toEqual({ triage: "unscored", importance: null, reason: "llm unavailable" });
  });
  it("fails open on null parsed_output", async () => {
    const client = mkClient(async () => ({ parsed_output: null }));
    expect((await createScorer(client, "m")(mail)).triage).toBe("unscored");
  });
});
