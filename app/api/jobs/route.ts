import { failed, ok } from "@/lib/api";
import { config } from "@/lib/config";
import { listJobs } from "@/lib/db";
import type { ApplicationStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID: ApplicationStatus[] = [
  "new",
  "saved",
  "tailored",
  "applied",
  "interviewing",
  "rejected",
  "dismissed",
];

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const statusParam = url.searchParams.getAll("status");
    const status = statusParam.filter((s): s is ApplicationStatus =>
      VALID.includes(s as ApplicationStatus),
    );
    const limit = Number(url.searchParams.get("limit") ?? 200);
    // "all" shows everything ever found; the default view is the fresh window.
    const scope = url.searchParams.get("scope") ?? "recent";

    const items = listJobs({
      status: status.length ? status : undefined,
      maxAgeDays: scope === "all" ? undefined : config.maxJobAgeDays,
      limit: Number.isFinite(limit) ? Math.min(limit, 500) : 200,
    });

    return ok({ items, maxJobAgeDays: config.maxJobAgeDays, scope });
  } catch (err) {
    return failed(err, "jobs list");
  }
}
