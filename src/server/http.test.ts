import { describe, expect, it, vi } from "vitest";
import { isJsonRequest, publicBaseUrl, requireJson } from "./http";

describe("publicBaseUrl", () => {
  it("uses PUBLIC_URL, reduced to its origin", () => {
    expect(publicBaseUrl({ PUBLIC_URL: "https://op.example.com/some/path/" })).toBe("https://op.example.com");
  });
  it("falls back to the Fly app's address, then to this machine", () => {
    expect(publicBaseUrl({ FLY_APP_NAME: "openpapr" })).toBe("https://openpapr.fly.dev");
    expect(publicBaseUrl({ PUBLIC_URL: "not a url", FLY_APP_NAME: "openpapr" })).toBe("https://openpapr.fly.dev");
    expect(publicBaseUrl({ PUBLIC_URL: "javascript:alert(1)" })).toBe("http://localhost:3000");
    expect(publicBaseUrl({ PORT: "3101" })).toBe("http://localhost:3101");
  });

  // A self-hosted server without PUBLIC_URL would hand out localhost links.
  it("warns once when a production server falls back to localhost", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      publicBaseUrl({ PORT: "3000" });
      expect(warn).not.toHaveBeenCalled();
      publicBaseUrl({ NODE_ENV: "production" });
      publicBaseUrl({ NODE_ENV: "production" });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toMatch(/PUBLIC_URL/);
    } finally { warn.mockRestore(); }
  });
});

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
