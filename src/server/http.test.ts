import { describe, expect, it } from "vitest";
import { isJsonRequest, requireJson } from "./http";

const req = (type?: string) => new Request("http://x/api", { method: "POST", headers: type ? { "Content-Type": type } : {}, body: "{}" });

describe("requireJson", () => {
  it("lets a JSON request through, whatever the charset or case", () => {
    expect(requireJson(req("application/json"))).toBeNull();
    expect(requireJson(req("Application/JSON; charset=utf-8"))).toBeNull();
  });

  // What a cross-site form can send without a preflight.
  it("turns away form and text posts with a 415", async () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", undefined]) {
      const res = requireJson(req(type));
      expect(res?.status).toBe(415);
      expect(await res?.json()).toEqual({ error: "expected a JSON body" });
    }
    expect(isJsonRequest(req("text/plain"))).toBe(false);
  });
});
