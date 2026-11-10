import { claudeProvider, config, isMockJobs } from "@/lib/config";
import { statusCounts, usageSummary } from "@/lib/db";
import { failed, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok({
      usage: usageSummary(),
      statusCounts: statusCounts(),
      providers: {
        claude: claudeProvider(),
        jobs: config.jobSource,
        jobsAreMocked: isMockJobs(),
        scoringModel: config.scoringModel,
        tailorModel: config.tailorModel,
      },
      settings: {
        maxJobAgeDays: config.maxJobAgeDays,
        scoreTopN: config.scoreTopN,
      },
    });
  } catch (err) {
    return failed(err, "usage");
  }
}
