import { bad, failed, ok } from "@/lib/api";
import { config } from "@/lib/config";
import { getProfile, upsertJobs, usageSummary } from "@/lib/db";
import { runSearch } from "@/lib/jobs";
import { scoreJobs } from "@/lib/match";

export const runtime = "nodejs";
// Searching hits an external API and Claude; it must never be cached.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    const profile = getProfile();
    if (!profile) {
      return bad("Upload a resume before searching.", 404);
    }
    if (!profile.preferences.targetTitles.length) {
      return bad(
        "Add at least one target job title on the preferences screen - the " +
          "search needs something to look for.",
      );
    }

    const search = await runSearch(profile.preferences);

    // Store before scoring, so a scoring failure does not lose the postings.
    const written = upsertJobs(search.jobs);

    let scoring;
    let scoringError: string | null = null;
    try {
      scoring = await scoreJobs(search.jobs, profile);
    } catch (err) {
      // The postings are already saved and carry prefilter ordering, so a
      // scoring failure degrades the result rather than losing the search.
      scoringError =
        err instanceof Error
          ? err.message
          : "Scoring failed for an unknown reason.";
    }

    return ok({
      queries: search.queries,
      stats: {
        ...search.stats,
        newJobs: written.inserted,
        refreshedJobs: written.refreshed,
        jobsScored: scoring?.scoredCount ?? 0,
        reusedScores: scoring?.reusedCount ?? 0,
        claudeUsd: scoring?.usd ?? 0,
        scoringProvider: scoring?.provider ?? "none",
      },
      warnings: [
        ...search.warnings,
        ...(scoringError
          ? [
              `Postings were saved, but scoring failed: ${scoringError} ` +
                "They are ranked by keyword overlap only.",
            ]
          : []),
      ],
      usage: usageSummary(),
      maxJobAgeDays: config.maxJobAgeDays,
    });
  } catch (err) {
    return failed(err, "search");
  }
}
