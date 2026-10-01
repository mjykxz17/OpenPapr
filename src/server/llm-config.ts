import type { Db } from "@/db/client";
import { getUser } from "@/db/repo";
import { loadEnv } from "@/lib/env";
import { sharedLlmConfig, userLlmConfig } from "@/lib/llm-provider";
import { setUsageListener, type CompatConfig } from "@/enrich/openai-compat";
import { getDb } from "./db";
import { recordLlmCall, sharedAllowanceLeft, usageThisMonth } from "./llm-usage";

// The model a student's requests go to from the web server: their own key,
// or the shared one while this month's allowance lasts. Tagged with who it is
// for, so every call is counted.
setUsageListener((o) => recordLlmCall(getDb(), o.userId, o.shared, Date.now()));

export function cfgForUser(db: Db, userId: number, now = Date.now()): CompatConfig | null {
  const env = loadEnv();
  const user = getUser(db, userId);
  // The demo account borrows the owner's model, never their content, and
  // stops for the day after DEMO_DAILY_CALLS (its usage row is wiped nightly).
  if (user?.isDemo) {
    const owner = getUser(db, env.DEMO_AI_USER);
    const cfg = (owner && !owner.isDemo ? userLlmConfig(owner, env.SECRET_KEY) : null) ?? sharedLlmConfig(env);
    if (!cfg || usageThisMonth(db, userId, now).calls >= env.DEMO_DAILY_CALLS) return null;
    return { ...cfg, owner: { userId, shared: true } };
  }
  const own = user ? userLlmConfig(user, env.SECRET_KEY) : null;
  if (own) return { ...own, owner: { userId, shared: false } };
  const shared = sharedLlmConfig(env);
  if (!shared || sharedAllowanceLeft(db, userId, now, env.SHARED_MONTHLY_CALLS) <= 0) return null;
  return { ...shared, owner: { userId, shared: true } };
}

// Whether this student is on the shared key and has run out for the month.
export function sharedLimitReached(db: Db, userId: number, now = Date.now()): boolean {
  const env = loadEnv();
  const user = getUser(db, userId);
  if (user && userLlmConfig(user, env.SECRET_KEY)) return false;
  return Boolean(sharedLlmConfig(env)) && sharedAllowanceLeft(db, userId, now, env.SHARED_MONTHLY_CALLS) <= 0;
}
