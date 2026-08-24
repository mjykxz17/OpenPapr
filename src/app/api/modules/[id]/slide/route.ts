import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { modules, users } from "@/db/schema";
import { loadEnv } from "@/lib/env";
import { decrypt } from "@/lib/crypto";
import { createCanvasClient, isPdfFile } from "@/connectors/canvas/client";
import { renderPdfPage } from "@/lib/pdf-render";

const stem = (name: string) => name.replace(/\.[^.]+$/, "");

// Renders a single slide (page) of a module's Canvas deck to PNG, so a study
// guide can embed the slide's actual figure inline. Ownership-checked, PDF-only.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const moduleId = Number(id);
  const url = new URL(request.url);
  const name = url.searchParams.get("name");
  const page = Number(url.searchParams.get("page"));
  if (!Number.isFinite(moduleId) || !name || !Number.isInteger(page) || page < 1) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const userId = 1; // TODO(phase-3): session → userId
  const db = getDb();
  const mod = db.select().from(modules).where(eq(modules.id, moduleId)).get();
  if (!mod || mod.userId !== userId) return NextResponse.json({ error: "not found" }, { status: 404 });

  const env = loadEnv();
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user?.canvasTokenEnc) return NextResponse.json({ error: "no canvas token" }, { status: 502 });

  const canvas = createCanvasClient(env.CANVAS_BASE_URL, decrypt(user.canvasTokenEnc, env.SECRET_KEY));
  let bytes: Uint8Array;
  try {
    const files = await canvas.listCourseFiles(mod.canvasCourseId);
    const file = files.find((f) => isPdfFile(f) && stem(f.display_name).toLowerCase() === name.toLowerCase());
    if (!file) return NextResponse.json({ error: "deck not found" }, { status: 404 });
    bytes = await canvas.downloadFile(file.url);
  } catch {
    return NextResponse.json({ error: "canvas unavailable" }, { status: 502 });
  }

  const png = await renderPdfPage(bytes, page);
  if (!png) return NextResponse.json({ error: "render failed" }, { status: 502 });
  return new NextResponse(Buffer.from(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
