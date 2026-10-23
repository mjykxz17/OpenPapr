// What a page may load. Everything comes from this site: the study guide
// renders course text as markdown, so an image pointing elsewhere could carry
// data out in its URL, and nothing here needs another origin.
// - script: only scripts carrying this response's nonce, and what they load
//   ('strict-dynamic'), so a <script> or onclick= slipped into the page never
//   runs. Next puts the nonce on its own scripts; the layout puts it on the
//   theme and banner scripts. Every page is rendered per request (the layout
//   reads the nonce), so each response gets its own. 'self' is only for
//   browsers too old for 'strict-dynamic'. pdf.js decodes some images with
//   WebAssembly; React's dev build uses eval.
// - style: mermaid draws its diagrams with inline styles. No nonce here: one
//   would switch 'unsafe-inline' off.
// - font: pdf.js may hand a deck's embedded font over as a data: URL.
// - blob: covers pdf.js and offline copies built in the page.
export function pagePolicy(nonce: string, dev = process.env.NODE_ENV === "development"): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}`,
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
}

// A fresh, unguessable nonce for one response, in the base64 form CSP takes.
export const newNonce = () => Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
