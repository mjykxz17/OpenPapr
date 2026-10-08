// Bundles the background worker into one plain JavaScript file so that in
// production it starts with `node dist/worker.cjs` — no TypeScript compiling
// at boot. On the one shared core the machine runs on, compiling the worker
// with tsx took over a minute every time it woke from sleep, and ~250MB of
// memory, while the web server starved beside it.
//
// Only the app's own files are bundled; packages in node_modules (native
// better-sqlite3, pdfjs, LibreOffice helpers) load as they are.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
await build({
  entryPoints: ["src/worker/index.ts"],
  outfile: "dist/worker.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  packages: "external",
  sourcemap: true,
  logLevel: "info",
  banner: { js: "// built by scripts/build-worker.mjs — do not edit" },
});
