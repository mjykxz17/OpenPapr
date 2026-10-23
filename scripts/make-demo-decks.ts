// run: npx tsx scripts/make-demo-decks.ts
//
// Writes the demo's slide decks, src/demo/decks/<stem>.pdf, from their text
// in src/demo/decks.ts. The output is deterministic, so re-running it on an
// unchanged decks.ts changes nothing; src/demo/decks.test.ts fails if the
// committed PDFs and their source drift apart.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO_DECK_SOURCES } from "../src/demo/decks";
import { deckPdf } from "../src/demo/pdf";

const dir = join(process.cwd(), "src", "demo", "decks");
mkdirSync(dir, { recursive: true });
const keep = new Set(DEMO_DECK_SOURCES.map((d) => `${d.stem}.pdf`));
// A deck taken out of decks.ts goes from the folder too.
for (const f of readdirSync(dir)) if (f.endsWith(".pdf") && !keep.has(f)) rmSync(join(dir, f));
for (const d of DEMO_DECK_SOURCES) {
  const bytes = deckPdf(d);
  writeFileSync(join(dir, `${d.stem}.pdf`), bytes);
  console.log(`${d.stem}.pdf  ${d.slides.length + 1} pages, ${bytes.length} bytes`);
}
