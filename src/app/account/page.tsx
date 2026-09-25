import { getDb } from "@/server/db";
import { requireUserId } from "@/server/session";
import { getUser } from "@/db/repo";
import { loadEnv } from "@/lib/env";
import { decrypt } from "@/lib/crypto";
import { secretHint, sharedLlmConfig, userLlmSlot } from "@/lib/llm-provider";
import { AppShell } from "@/components/AppShell";
import { AccountSettings } from "@/components/AccountSettings";
import { userProfileView } from "@/server/profiles";
import { canGenerateGuides } from "@/server/llm-access";

export const dynamic = "force-dynamic";

// Everything the account is linked to, in one place. Secrets are decrypted
// here only to take their last four characters; the values themselves never
// reach the browser.
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const userId = await requireUserId();
  const { welcome } = await searchParams;
  const env = loadEnv();
  const user = getUser(getDb(), userId)!;

  let canvasHint: string | null = null;
  if (user.canvasTokenEnc) {
    try { canvasHint = secretHint(decrypt(user.canvasTokenEnc, env.SECRET_KEY)); } catch { canvasHint = null; }
  }
  const own = userLlmSlot(user, "primary", env.SECRET_KEY);
  const fb = userLlmSlot(user, "fallback", env.SECRET_KEY);
  const view = (c: typeof own) => (c ? { baseUrl: c.baseUrl, model: c.model, keyHint: secretHint(c.apiKey), rpm: c.rpm ?? null, extra: c.extra ? JSON.stringify(c.extra, null, 2) : "" } : null);
  const shared = sharedLlmConfig(env);
  const sharedModel = shared?.model ?? (env.ANTHROPIC_API_KEY ? env.ANTHROPIC_MODEL : null);
  const about = { ...userProfileView(getDb(), userId), hasModel: canGenerateGuides(getDb(), userId) };

  return (
    <AppShell>
      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line pb-4">
        <h1 className="text-2xl font-semibold tracking-[-0.01em] text-ink">Account</h1>
        <span className="text-[13px] text-ink-2">{user.name}</span>
      </header>
      <AccountSettings
        welcome={welcome === "1"}
        canvasBaseUrl={env.CANVAS_BASE_URL}
        canvas={{
          name: user.name,
          tokenHint: canvasHint,
          verifiedAt: user.canvasVerifiedAt ?? null,
          failedAt: user.canvasTokenFailedAt ?? null,
        }}
        llm={view(own)}
        fallback={view(fb)}
        sharedModel={sharedModel}
        signIn={{ username: user.username ?? null, hasPassword: Boolean(user.passwordHash) }}
        about={about}
      />
    </AppShell>
  );
}
