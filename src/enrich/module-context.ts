import { and, eq, isNotNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Db } from "../db/client";
import { components, files, moduleContext, modules, users } from "../db/schema";
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

// --- deciding when to read a module's decks -------------------------------

// Fingerprints the deck set a profile was written from. Names and sizes both
// count: a new lecture appears as a new name, and a re-uploaded deck keeps its
// name but changes size. When this differs from what is stored, the module has
// changed since it was last read and is worth reading again.
export function deckSetKey(decks: { displayName: string; sizeBytes: number | null }[]): string {
  const lines = decks.map((d) => `${d.displayName}:${d.sizeBytes ?? 0}`).sort().join("\n");
  return createHash("sha1").update(lines).digest("hex").slice(0, 16);
}

// Profiling is not free — it downloads decks — so a module is read once per
// deck set and then left alone. Failures back off and eventually stop: a
// module whose decks cannot be read must not be retried every sweep forever.
export const MAX_PROFILE_ATTEMPTS = 3;
export const PROFILE_RETRY_MS = 6 * 60 * 60_000;

export interface ProfileState {
  profile: string | null;
  profileDeckKey: string | null;
  profileCheckedAt: number | null;
  profileAttempts: number;
}

export function needsProfile(stored: ProfileState | undefined, deckKey: string, now: number): boolean {
  if (!deckKey) return false;                                    // no decks, nothing to read
  if (!stored) return true;
  if (stored.profile && stored.profileDeckKey === deckKey) return false;  // current
  if (stored.profileAttempts >= MAX_PROFILE_ATTEMPTS) return false;       // given up
  if (stored.profileAttempts > 0 && stored.profileCheckedAt !== null
      && now - stored.profileCheckedAt < PROFILE_RETRY_MS) return false;  // backing off
  return true;
}

// A whole module's decks are more than a profile needs, and downloading them
// all for one is wasteful. Sampling evenly keeps the shape of the module —
// its opening, its middle, where it ends up — rather than only its first
// weeks, which is what a plain slice would give.
export function sampleDecksForProfile<T>(decks: T[], max = 6): T[] {
  if (decks.length <= max) return decks;
  const step = (decks.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => decks[Math.round(i * step)]!);
}

export interface ProfileCandidate {
  userId: number;
  moduleId: number;
  code: string;
  name: string;
  deckKey: string;
  decks: { canvasFileId: number; displayName: string }[];
}

// The one module most worth reading right now, or null when every module is
// current. Never-read modules come first, then the longest since an attempt,
// so a new enrolment is profiled before an old one is re-read. Only active
// modules of users whose Canvas token is present, since reading needs both.
export function selectProfileCandidate(db: Db, now: number): ProfileCandidate | null {
  const rows = db.select({ mod: modules }).from(modules)
    .innerJoin(users, eq(users.id, modules.userId))
    .where(and(eq(modules.active, true), isNotNull(users.canvasTokenEnc)))
    .all();

  const due: { candidate: ProfileCandidate; checkedAt: number | null }[] = [];
  for (const { mod } of rows) {
    const decks = selectGuideDecks(db.select().from(files).where(eq(files.moduleId, mod.id)).all());
    if (decks.length === 0) continue;
    const deckKey = deckSetKey(decks);
    const stored = db.select().from(moduleContext).where(eq(moduleContext.moduleId, mod.id)).get();
    if (!needsProfile(stored, deckKey, now)) continue;
    due.push({
      candidate: {
        userId: mod.userId, moduleId: mod.id, code: mod.code, name: mod.name, deckKey,
        decks: sampleDecksForProfile(decks).map((d) => ({ canvasFileId: d.canvasFileId, displayName: d.displayName })),
      },
      checkedAt: stored?.profileCheckedAt ?? null,
    });
  }

  due.sort((a, b) => (a.checkedAt ?? -1) - (b.checkedAt ?? -1));
  return due[0]?.candidate ?? null;
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
