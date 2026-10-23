import type { NextConfig } from "next";

// What a page may load. Everything comes from this site: the study guide
// renders course text as markdown, so an image pointing elsewhere could carry
// data out in its URL, and nothing here needs another origin.
// - script: Next's own inline bootstrap and the theme script in the layout
//   need 'unsafe-inline' (no nonces: they would make every page dynamic);
//   pdf.js decodes some images with WebAssembly; React's dev build uses eval.
// - style: mermaid draws its diagrams with inline styles.
// - font: pdf.js may hand a deck's embedded font over as a data: URL.
// - blob: covers pdf.js and offline copies built in the page.
const isDev = process.env.NODE_ENV === "development";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

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
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // Pages, not the API: a file served from the API carries its own
        // sandboxed policy (see streamFile), and JSON needs none.
        source: "/((?!api/).*)",
        headers: [{ key: "Content-Security-Policy", value: csp }],
      },
    ];
  },
};

export default nextConfig;
