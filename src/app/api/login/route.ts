import { NextResponse } from "next/server";
import { signSession } from "@/server/auth";
import { loadEnv } from "@/lib/env";

export async function POST(request: Request) {
  const { password } = await request.json();
  const env = loadEnv();
  if (password !== env.APP_PASSWORD) {
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
