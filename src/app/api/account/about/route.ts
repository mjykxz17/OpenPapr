import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { accountRequest, str } from "@/server/account-request";
import { users } from "@/db/schema";

export const dynamic = "force-dynamic";

// What the student tells OpenPapr about themselves. Changing it asks for the
// profile to be rebuilt; switching style learning off also forgets the style
// already derived from their notes.
export async function PUT(request: Request) {
  const req = await accountRequest(request);
  if ("res" in req) return req.res;
  const major = str(req.body.major).slice(0, 120) || null;
  const yearRaw = req.body.studyYear;
  const studyYear = yearRaw === null || yearRaw === "" || yearRaw === undefined ? null : Number(yearRaw);
  if (studyYear !== null && (!Number.isInteger(studyYear) || studyYear < 1 || studyYear > 6)) {
    return NextResponse.json({ error: "year of study should be 1 to 6" }, { status: 400 });
  }
  const styleLearning = req.body.styleLearning !== false;
  getDb().update(users).set({
    major, studyYear, styleLearning, profileRequestedAt: Date.now(), profileError: null,
    ...(styleLearning ? {} : { writingStyleJson: null, writingStyleAt: null, writingStyleNotesChars: null }),
  }).where(eq(users.id, req.userId)).run();
  return NextResponse.json({ ok: true });
}
