import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { modules, users } from "@/db/schema";
import { loadEnv } from "@/lib/env";
import { decrypt } from "@/lib/crypto";
import { createCanvasClient, isPdfFile } from "@/connectors/canvas/client";

const stem = (name: string) => name.replace(/\.[^.]+$/, "");

// Streams a module's source slide deck (a Canvas PDF) so the study guide's
// slide citations can open it at a given page. Scoped to the owning user and
// to PDF files that belong to the module's own course.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const moduleId = Number(id);
  const name = new URL(request.url).searchParams.get("name");
  if (!Number.isFinite(moduleId) || !name) {
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
  let file;
  try {
    const files = await canvas.listCourseFiles(mod.canvasCourseId);
    file = files.find((f) => isPdfFile(f) && stem(f.display_name).toLowerCase() === name.toLowerCase());
  } catch {
    return NextResponse.json({ error: "canvas unavailable" }, { status: 502 });
  }
  if (!file) return NextResponse.json({ error: "deck not found" }, { status: 404 });

  try {
    const bytes = await canvas.downloadFile(file.url);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${stem(file.display_name)}.pdf"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "download failed" }, { status: 502 });
  }
}
