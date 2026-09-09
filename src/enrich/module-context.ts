import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { components, files, modules } from "../db/schema";
import { getModuleContext } from "../db/repo";
import { renderModuleContext, type ModuleContextInput } from "../lib/module-context";
import { withShadowFlags } from "../lib/component-display";
import { selectGuideDecks } from "./study-guide";
import { chatText, type CompatConfig } from "./openai-compat";

const deckStem = (name: string) => name.replace(/\.[^.]+$/, "");

// Everything the model is told about a module, assembled from what the
// database holds right now. Returned in pieces as well as rendered, since
// the module page shows the pieces and the prompt takes the whole.
export function loadModuleContext(db: Db, moduleId: number): { input: ModuleContextInput; context: string; profiledAt: number | null; profileSource: string | null; notesUpdatedAt: number | null } | null {
  const mod = db.select().from(modules).where(eq(modules.id, moduleId)).get();
  if (!mod) return null;
  // A manual weight overrides the Canvas one for the same component on the
  // page; the prompt gets the same single answer rather than both.
  const comps = withShadowFlags(db.select().from(components).where(eq(components.moduleId, moduleId)).all()).filter((c) => !c.shadowed);
  const decks = selectGuideDecks(db.select().from(files).where(eq(files.moduleId, moduleId)).all()).map((d) => deckStem(d.displayName));
  const stored = getModuleContext(db, moduleId);
  const input: ModuleContextInput = {
    code: mod.code, name: mod.name, term: mod.term,
    components: comps.map((c) => ({ name: c.name, weightPct: c.weightPct, source: c.source })),
    decks,
    profile: stored?.profile ?? null,
    notes: stored?.notes ?? null,
  };
  return {
    input,
    context: renderModuleContext(input),
    profiledAt: stored?.profiledAt ?? null,
    profileSource: stored?.profileSource ?? null,
    notesUpdatedAt: stored?.notesUpdatedAt ?? null,
  };
}

// --- profiling -----------------------------------------------------------

// A whole module's decks run to hundreds of thousands of characters, far
// more than a profile needs. The opening of a deck says what it is about and
// how the lecturer frames things; a slice from the middle shows how the body
// of a lecture is taught. Together they are enough to describe a style.
export function sampleDeck(text: string, headChars = 1800, midChars = 1200): string {
  const t = text.trim();
  if (t.length <= headChars + midChars) return t;
  const head = t.slice(0, headChars);
  const midStart = Math.floor((t.length - midChars) / 2);
  const mid = t.slice(midStart, midStart + midChars);
  return `${head}\n[...]\n${mid}\n[...]`;
}

const PROFILE_SYSTEM = `You are briefing a writer who will turn a university module's lecture decks into a study guide. From the deck samples you are given, describe the module and the lecturer so the writer can match them.

Write markdown, under 350 words, with exactly these headings and nothing else:
### What the module is about
### How the lecturer teaches
(structure of a lecture, whether they lead with examples or definitions, how code, commands, figures and demos are used, tone, devices they keep returning to)
### Terminology and notation to keep
### Threads that run across decks
### What is signalled as important or examinable

Base every sentence on the samples. Where the samples do not show something, write "not evident from the slides" rather than guess. No preamble, no closing remarks.`;

export type ModuleProfiler = (module: { code: string; name: string }, decks: { name: string; text: string }[]) => Promise<string | null>;

// Fail-open like the other enrichers: a profile is a nicety on top of the
// facts, so a failed call returns null and the guide is written without it.
export function createModuleProfiler(cfg: CompatConfig, fetchFn: typeof fetch = fetch, maxTotalChars = 60_000): ModuleProfiler {
  return async (module, decks) => {
    if (decks.length === 0) return null;
    const samples: string[] = [];
    let used = 0;
    for (const d of decks) {
      const sample = `=== ${d.name} ===\n${sampleDeck(d.text)}`;
      if (used + sample.length > maxTotalChars) break;
      samples.push(sample);
      used += sample.length;
    }
    try {
      const text = await chatText(
        cfg, PROFILE_SYSTEM,
        `Module: ${module.code} ${module.name}\nDecks sampled: ${samples.length} of ${decks.length}\n\n${samples.join("\n\n")}`,
        { maxTokens: 1500, temperature: 0.2, timeoutMs: 120_000, fetchFn },
      );
      const trimmed = text.trim();
      return trimmed.startsWith("###") ? trimmed : null;
    } catch {
      return null;
    }
  };
}
