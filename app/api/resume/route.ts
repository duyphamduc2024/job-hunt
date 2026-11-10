import fs from "node:fs/promises";
import path from "node:path";
import { bad, failed, ok } from "@/lib/api";
import { config } from "@/lib/config";
import { getProfile, saveProfile } from "@/lib/db";
import { readDocx } from "@/lib/docx";
import { parseResume, seedPreferences } from "@/lib/resume";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return bad("No file was uploaded. Choose a .docx resume.");
    }

    const name = file.name || "resume.docx";
    const lower = name.toLowerCase();

    if (lower.endsWith(".pdf")) {
      return bad(
        "PDFs are not supported. Tailoring edits your resume in place and " +
          "needs the original Word file, so upload the .docx.",
      );
    }
    if (lower.endsWith(".doc")) {
      return bad(
        "That is the older .doc format. Open it in Word and save as .docx.",
      );
    }
    if (!lower.endsWith(".docx")) {
      return bad(`Only .docx files are accepted. You uploaded "${name}".`);
    }
    if (file.type && file.type !== DOCX_MIME && file.type !== "application/octet-stream") {
      return bad(
        `That file says it is "${file.type}", not a Word document. Re-save it as .docx.`,
      );
    }
    if (file.size > MAX_BYTES) {
      return bad(
        `That file is ${(file.size / 1048576).toFixed(1)}MB. The limit is 10MB - ` +
          "a resume with large embedded images can hit this.",
      );
    }
    if (file.size === 0) {
      return bad("That file is empty.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Parse BEFORE storing, so a bad file never becomes the stored resume.
    const doc = await readDocx(buffer);
    if (!doc.paragraphs.some((p) => p.text.length > 0)) {
      return bad(
        "That .docx has no readable text. If your resume is an image or is " +
          "built entirely from graphics, it cannot be parsed or tailored.",
      );
    }

    await fs.mkdir(config.resumeDir, { recursive: true });
    const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const storedPath = path.join(config.resumeDir, `${Date.now()}-${safeName}`);
    await fs.writeFile(storedPath, buffer);

    const { profile: resume, usedFallback, usd } = await parseResume(doc);

    // Keep preferences the user already set; only seed them on a first upload.
    const existing = getProfile();
    const preferences = existing?.preferences ?? seedPreferences(resume);

    const saved = saveProfile({
      resume,
      preferences,
      resumeFilename: name,
      resumePath: storedPath,
      resumeText: doc.plainText,
      // A fresh resume always needs re-confirming on the review screen.
      confirmedAt: null,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return ok({
      profile: saved,
      paragraphCount: doc.paragraphs.length,
      usedFallback,
      usd,
      notice: usedFallback
        ? "Extracted without Claude (mock mode or a failed call), using " +
          "pattern matching only. Check every field on the next screens."
        : null,
    });
  } catch (err) {
    return failed(err, "resume upload");
  }
}
