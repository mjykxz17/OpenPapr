import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

// The headers next.config.ts sends. The study guide renders course text as
// markdown, so the page policy is what stops an image tag in it from sending
// data to another site.
async function rules() {
  const all = await nextConfig.headers!();
  const find = (key: string) => all.find((r) => r.headers.some((h) => h.key === key))!;
  const value = (key: string) => find(key).headers.find((h) => h.key === key)!.value;
  return { find, value };
}

describe("security headers", () => {
  it("keeps the site out of other sites' frames, on every response", async () => {
    const { find, value } = await rules();
    expect(find("X-Frame-Options").source).toBe("/:path*");
    expect(value("X-Frame-Options")).toBe("DENY");
    expect(value("X-Content-Type-Options")).toBe("nosniff");
    expect(value("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("lets pages load images only from this site", async () => {
    const { value } = await rules();
    const csp = Object.fromEntries(value("Content-Security-Policy").split("; ").map((d) => {
      const [name, ...rest] = d.split(" ");
      return [name, rest.join(" ")];
    }));
    expect(csp["img-src"]).toBe("'self' data: blob:");
    expect(csp["frame-ancestors"]).toBe("'none'");
    expect(csp["connect-src"]).toBe("'self'");
    expect(csp["object-src"]).toBe("'none'");
    // WebAssembly only; string eval stays off outside development.
    expect(csp["script-src"]!.split(" ")).not.toContain("'unsafe-eval'");
  });

  it("puts the page policy on pages, not on the API's own files", async () => {
    const { find } = await rules();
    const page = new RegExp(`^${find("Content-Security-Policy").source}$`);
    expect(page.test("/")).toBe(true);
    expect(page.test("/modules/3/guide")).toBe(true);
    expect(page.test("/api/modules/3/files/9")).toBe(false);
  });
});
