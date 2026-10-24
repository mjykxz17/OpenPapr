import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { publicBaseUrl } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { handleRpc } from "@/server/mcp/protocol";
import { userForMcpKey } from "@/server/mcp/token";
import { INSTRUCTIONS, TOOLS } from "@/server/mcp/tools";

export const dynamic = "force-dynamic";

const SERVER = { name: "openpapr", version: "1.0.0", instructions: INSTRUCTIONS };
const MAX_BODY = 1_000_000;

// The MCP server Claude Code connects to (Account → Claude Code). No session:
// the client sends the student's key as a bearer token, and every tool reads
// only what that key's account owns. Stateless — each POST is answered on its
// own, with JSON — so there is no event stream to GET and no session to DELETE.
export async function POST(request: Request) {
  // Claude Code sends no Origin. A web page does, and could only send the key
  // after a CORS preflight this route never answers; one that is not
  // OpenPapr's own is turned away before the key is even looked at.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(publicBaseUrl()).origin) return NextResponse.json({ error: "forbidden origin" }, { status: 403 });

  const db = getDb();
  const userId = userForMcpKey(db, request.headers.get("authorization"));
  if (userId === null) {
    return NextResponse.json({ error: "unauthorized — make a key in OpenPapr under Account → Claude Code" }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="openpapr"' } });
  }
  if (!rateLimit(`mcp:${userId}`, 600, 10 * 60_000)) {
    return NextResponse.json({ error: "too many requests — wait a few minutes" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "request too large" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { status: 400 });
  }

  const ctx = { db, userId, now: Date.now() };
  // Older clients may send several messages in one array.
  const replies = Array.isArray(body)
    ? (await Promise.all(body.map((m) => handleRpc(m, TOOLS, ctx, SERVER)))).filter((r) => r !== null)
    : await handleRpc(body, TOOLS, ctx, SERVER);
  if (replies === null || (Array.isArray(replies) && replies.length === 0)) return new Response(null, { status: 202 });
  return NextResponse.json(replies, { headers: { "Cache-Control": "no-store" } });
}

const notHere = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
export const GET = notHere;
export const DELETE = notHere;
