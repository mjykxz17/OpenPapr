import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { currentUserId } from "@/server/session";
import { listChats } from "@/server/pet-chats";

export const dynamic = "force-dynamic";

// The student's conversations with Papi, newest first.
export async function GET() {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ sessions: listChats(getDb(), userId) });
}
