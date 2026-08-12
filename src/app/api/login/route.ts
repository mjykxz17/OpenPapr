import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { signSession } from "@/server/auth";
import { loadEnv } from "@/lib/env";

export async function POST(request: Request) {
  let password: string | undefined;
  try {
    ({ password } = await request.json());
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }
  const env = loadEnv();
  const a = createHash("sha256").update(password ?? "").digest();
  const b = createHash("sha256").update(env.APP_PASSWORD).digest();
  if (!timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("session", signSession(env.SECRET_KEY), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
  });
  return res;
}
