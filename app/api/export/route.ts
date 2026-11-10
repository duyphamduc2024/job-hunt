import * as z from "zod/v4";
import { bad, failed, ok } from "@/lib/api";
import { exportApplication } from "@/lib/applications";
import { writeCoverLetter } from "@/lib/coverletter";
import {
  getApplication,
  getJob,
  getMatch,
  getProfile,
  latestTailoring,
  usageSummary,
} from "@/lib/db";
import { tailorResume } from "@/lib/tailor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BodySchema = z.object({
  jobId: z.string().min(1),
  /** Tailor the resume if it has not been tailored yet. Default true. */
  tailor: z.boolean().optional(),
  /** Generate a cover letter. Default true. */
  coverLetter: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return bad("A jobId is required.");
    const { jobId } = parsed.data;
    const wantTailor = parsed.data.tailor ?? true;
    const wantLetter = parsed.data.coverLetter ?? true;

    const profile = getProfile();
    if (!profile) return bad("Upload a resume first.", 404);
    const job = getJob(jobId);
    if (!job) return bad("No such job.", 404);

    let spent = 0;
    const steps: string[] = [];

    // Reuse an existing tailoring rather than paying for it twice.
    let tailoring = latestTailoring(jobId);
    if (!tailoring && wantTailor) {
      const outcome = await tailorResume(profile, job);
      tailoring = outcome.tailoring;
      spent += outcome.usd;
      steps.push(
        `tailored the resume (${outcome.diffs.length} changes, ${outcome.rejected.length} blocked)`,
      );
    } else if (tailoring) {
      steps.push("reused the existing tailored resume");
    }

    let coverLetter = null;
    if (wantLetter) {
      const letter = await writeCoverLetter(profile, job);
      spent += letter.usd;
      coverLetter = {
        text: letter.text,
        claimsMade: letter.data.claimsMade,
        unverifiable: letter.unverifiable,
      };
      steps.push(
        letter.unverifiable.length
          ? `wrote a cover letter (${letter.unverifiable.length} claim(s) flagged for checking)`
          : "wrote a cover letter",
      );
    }

    const result = await exportApplication({
      profile,
      job,
      match: getMatch(jobId),
      application: getApplication(jobId) ?? {
        jobId,
        status: "new",
        notes: "",
        appliedAt: null,
        updatedAt: job.fetchedAt,
      },
      tailoring,
      tailoredDocxPath: tailoring?.docxPath ?? null,
      coverLetter,
    });

    return ok({
      dir: result.dir,
      files: result.files,
      steps,
      usd: spent,
      coverLetter,
      usage: usageSummary(),
    });
  } catch (err) {
    return failed(err, "export");
  }
}
