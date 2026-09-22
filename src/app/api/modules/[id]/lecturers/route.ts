import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { accountRequest, str } from "@/server/account-request";
import { getModuleProfileRow, ownedModule, patchModuleProfile, readLecturers } from "@/db/profiles-repo";
import { isNusStaffUrl } from "@/connectors/nusmods/staff-page";

export const dynamic = "force-dynamic";

// Sets (or clears) the public NUS staff page for one of the module's
// lecturers, or adds a lecturer Canvas does not list. Only nus.edu.sg pages
// are accepted; the worker reads the page on the next rebuild.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = await accountRequest(request);
  if ("res" in req) return req.res;
  const { id } = await params;
  const moduleId = Number(id);
  const db = getDb();
  if (!ownedModule(db, req.userId, moduleId)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const name = str(req.body.name).slice(0, 120);
  const rawUrl = str(req.body.staffUrl);
  if (!name) return NextResponse.json({ error: "enter the lecturer's name" }, { status: 400 });
  const url = rawUrl ? isNusStaffUrl(rawUrl) : null;
  if (rawUrl && !url) return NextResponse.json({ error: "use their public page on an nus.edu.sg site (https)" }, { status: 400 });

  const lecturers = readLecturers(getModuleProfileRow(db, moduleId)?.lecturersJson);
  const at = lecturers.findIndex((l) => l.name.toLowerCase() === name.toLowerCase());
  const entry = { name, staffUrl: url ? url.toString() : null, pageText: null, pageFetchedAt: null };
  if (at >= 0) lecturers[at] = { ...lecturers[at], ...entry, name: lecturers[at]!.name };
  else lecturers.push(entry);
  patchModuleProfile(db, moduleId, { lecturersJson: JSON.stringify(lecturers), requestedAt: Date.now(), error: null });
  return NextResponse.json({ ok: true });
}
