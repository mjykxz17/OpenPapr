import { NextResponse } from "next/server";
import type { Db } from "@/db/client";
import { getDb } from "./db";
import { DEMO_LOCKED, isDemoUser } from "./session";

// The public demo account is one account shared by every visitor. Browsing,
// ticking tasks, quick add, notes and asking are what it is there to show,
// and the nightly reset undoes them. Linking an account, changing a key or a
// password, deleting, exporting what other visitors typed, or asking for an
// expensive rebuild would reach past that one day, so those routes call this.
// session.ts's isDemoUser is the one test of what counts as the demo account.
export { DEMO_LOCKED, isDemoUser };
export const DEMO_NO_OUTLOOK = "This is the shared demo account, so it can't link a mailbox. Create your own account to connect Outlook.";
export const DEMO_NO_EXPORT = "This is the shared demo account, so there is nothing of yours to download. Create your own account to keep your data.";

// The 403 to hand back for the demo account, or null for anyone else.
export function demoLocked(userId: number, message = DEMO_LOCKED, db: Db = getDb()): NextResponse | null {
  return isDemoUser(userId, db) ? NextResponse.json({ error: message }, { status: 403 }) : null;
}
