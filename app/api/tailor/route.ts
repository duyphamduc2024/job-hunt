import * as z from "zod/v4";
import { bad, failed, ok } from "@/lib/api";
import { getApplication, getJob, getProfile, setStatus, usageSummary } from "@/lib/db";
import { tailorResume } from "@/lib/tailor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BodySchema = z.object({ jobId: z.string().min(1) });

export async function POST(req: Request) {
  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return bad("A jobId is required.");

    const profile = getProfile();
    if (!profile) return bad("Upload a resume first.", 404);
    if (!profile.resumePath) {
      return bad("No resume file on record. Upload your .docx again.", 404);
    }

    const job = getJob(parsed.data.jobId);
    if (!job) return bad("No such job.", 404);

    const outcome = await tailorResume(profile, job);

    // Only advance the status if the user has not already moved further on.
    const current = getApplication(job.id)?.status ?? "new";
    if (current === "new" || current === "saved") {
      setStatus(job.id, "tailored");
    }

    return ok({
      tailoring: outcome.tailoring,
      diffs: outcome.diffs,
      rejected: outcome.rejected,
      warnings: outcome.warnings,
      provider: outcome.provider,
      usd: outcome.usd,
      usage: usageSummary(),
      downloadUrl: `/api/tailor/${outcome.tailoring.id}/download`,
    });
  } catch (err) {
    return failed(err, "tailor");
  }
}
