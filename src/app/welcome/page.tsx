import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { requireUserId } from "@/server/session";
import { getUser } from "@/db/repo";
import { loadEnv } from "@/lib/env";
import { sharedLlmConfig, userLlmConfig } from "@/lib/llm-provider";
import { Welcome } from "@/components/onboarding/Welcome";

export const dynamic = "force-dynamic";

// The first-run steps: what OpenPapr does, then Canvas, an AI model and a
// little about the student, each one skippable. Home sends anyone who has
// not finished or skipped them here.
export default async function WelcomePage() {
  const userId = await requireUserId();
  const env = loadEnv();
  const user = getUser(getDb(), userId)!;
  if (user.isDemo) redirect("/");
  const own = userLlmConfig(user, env.SECRET_KEY);
  return (
    <Welcome
      name={user.name}
      canvasBaseUrl={env.CANVAS_BASE_URL}
      canvasLinked={Boolean(user.canvasTokenEnc)}
      ownModel={own ? own.model : null}
      sharedAvailable={Boolean(sharedLlmConfig(env))}
      sharedCalls={env.SHARED_MONTHLY_CALLS}
      major={user.major ?? ""}
      studyYear={user.studyYear ?? null}
    />
  );
}
