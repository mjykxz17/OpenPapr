import { NextRequest, NextResponse } from "next/server";

// The middleware bundle runs in the Edge runtime, which has no `node:crypto` —
// re-implement the same exp.hmacHex check from server/auth.ts with Web Crypto
// (crypto.subtle) here, and only here. server/auth.ts (used by route handlers,
// which run in the Node.js runtime) is untouched and remains the source of truth.
const hexToBytes = (hex: string): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
};

const bytesToHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const timingSafeEqualStr = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

// Mirrors verifySession in server/auth.ts: payload is "<userId>.<expiryMs>"
// and the signature covers it, so the user id cannot be swapped in the cookie.
// This gate only answers "is this a valid session" — route handlers and pages
// re-verify with server/auth.ts to learn *which* user it is.
async function verifySessionEdge(value: string | undefined, secretHex: string): Promise<boolean> {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [rawId, exp, sig] = parts as [string, string, string];
  if (!/^\d+$/.test(rawId) || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Date.now()) return false;
  const key = await crypto.subtle.importKey("raw", hexToBytes(secretHex), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${rawId}.${exp}`));
  const want = bytesToHex(new Uint8Array(mac));
  return timingSafeEqualStr(want, sig);
}

export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/login") || req.nextUrl.pathname === "/login") return NextResponse.next();
  const ok = await verifySessionEdge(req.cookies.get("session")?.value, process.env.SESSION_KEY ?? process.env.SECRET_KEY ?? "");
  if (ok) return NextResponse.next();
  return req.nextUrl.pathname.startsWith("/api")
    ? NextResponse.json({ error: "unauthorized" }, { status: 401 })
    : NextResponse.redirect(new URL("/login", req.url));
}
export const config = { matcher: ["/((?!_next|favicon.ico).*)"] };
