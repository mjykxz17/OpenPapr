import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession } from "./auth";
import { loadEnv, sessionSigningKey } from "@/lib/env";

// The authenticated user, or null. Middleware already turns anonymous traffic
// away, so a null here means a session that expired between the gate and the
// handler — or a caller reached directly. Either way there is no default user
// to fall back to.
export async function currentUserId(): Promise<number | null> {
  const jar = await cookies();
  return verifySession(jar.get("session")?.value, sessionSigningKey(loadEnv()));
}

// For server components: sends the visitor to sign in rather than rendering
// somebody else's dashboard.
export async function requireUserId(): Promise<number> {
  const id = await currentUserId();
  if (id === null) redirect("/login");
  return id;
}
