import * as z from "zod/v4";
import { bad, failed, ok } from "@/lib/api";
import {
  getApplication,
  getJob,
  getMatch,
  latestTailoring,
  setStatus,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  status: z.enum([
    "new",
    "saved",
    "tailored",
    "applied",
    "interviewing",
    "rejected",
    "dismissed",
  ]),
  notes: z.string().optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const job = getJob(id);
    if (!job) return bad("No such job.", 404);
    return ok({
      job,
      match: getMatch(id),
      application: getApplication(id) ?? {
        jobId: id,
        status: "new",
        notes: "",
        appliedAt: null,
        updatedAt: job.fetchedAt,
      },
      tailoring: latestTailoring(id),
    });
  } catch (err) {
    return failed(err, "job detail");
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!getJob(id)) return bad("No such job.", 404);

    const parsed = PatchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return bad(
        `Invalid update: ${parsed.error.issues
          .map((i) => i.message)
          .join("; ")}`,
      );
    }

    return ok({
      application: setStatus(id, parsed.data.status, parsed.data.notes),
    });
  } catch (err) {
    return failed(err, "job patch");
  }
}
