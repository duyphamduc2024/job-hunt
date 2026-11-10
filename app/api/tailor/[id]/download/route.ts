import fs from "node:fs/promises";
import path from "node:path";
import { bad, failed } from "@/lib/api";
import { config } from "@/lib/config";
import { getTailoring } from "@/lib/db";

export const runtime = "nodejs";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const tailoring = getTailoring(Number(id));
    if (!tailoring?.docxPath) return bad("No such tailored resume.", 404);

    // The path comes from our own database, but resolve and confine it anyway:
    // a download handler that will serve any path is a liability.
    const resolved = path.resolve(tailoring.docxPath);
    const root = path.resolve(config.tailoredDir);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      return bad("That file is outside the tailored-resume folder.", 403);
    }

    let file: Buffer;
    try {
      file = await fs.readFile(resolved);
    } catch {
      return bad(
        "The tailored file is no longer on disk. Generate it again.",
        410,
      );
    }

    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": DOCX_MIME,
        "Content-Length": String(file.length),
        "Content-Disposition": `attachment; filename="${path.basename(resolved)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return failed(err, "tailor download");
  }
}
