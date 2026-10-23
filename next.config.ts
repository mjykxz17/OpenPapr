import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pdf-parse pulls in pdfjs, whose worker is resolved at runtime from
  // node_modules — bundling it breaks that resolution (fake-worker error).
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
  async headers() {
    return [
      {
        // Every response: never inside another site's frame, no guessing of
        // content types, and only the origin in the Referer sent elsewhere.
        // A page's Content-Security-Policy carries a nonce of its own, so the
        // proxy sets it per request (src/proxy.ts, src/server/csp.ts).
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
