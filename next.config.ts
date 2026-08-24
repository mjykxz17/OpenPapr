import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pdf-parse pulls in pdfjs, whose worker is resolved at runtime from
  // node_modules — bundling it breaks that resolution (fake-worker error).
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
};

export default nextConfig;
