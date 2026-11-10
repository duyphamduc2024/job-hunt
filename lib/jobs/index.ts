import { config } from "../config";
import type { Job, Preferences } from "../types";
import { searchMock } from "./mock";
import {
  dedupeKeyFor,
  searchJSearch,
  type SearchQuery,
  type SourceResult,
} from "./jsearch";

// ---------------------------------------------------------------------------
// Search orchestration: turn preferences into queries, run them against the
// configured source, then enforce the two rules that matter - postings must
// be provably recent, and the same role posted on five boards is one row.
// ---------------------------------------------------------------------------

/** How many API calls one search is allowed to make. Each is billed, so this
 *  is the knob that decides how far a monthly quota stretches. */
const MAX_QUERIES_PER_SEARCH = 4;

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  fulltime: "FULLTIME",
  parttime: "PARTTIME",
  contract: "CONTRACTOR",
  temporary: "CONTRACTOR",
  internship: "INTERN",
};

const COUNTRY_HINTS: Record<string, string> = {
  "united kingdom": "gb",
  england: "gb",
  scotland: "gb",
  wales: "gb",
  uk: "gb",
  canada: "ca",
  australia: "au",
  germany: "de",
  france: "fr",
  india: "in",
  ireland: "ie",
  netherlands: "nl",
  singapore: "sg",
  spain: "es",
  mexico: "mx",
};

function countryFor(locations: string[]): string {
  const haystack = locations.join(" ").toLowerCase();
  for (const [name, code] of Object.entries(COUNTRY_HINTS)) {
    if (haystack.includes(name)) return code;
  }
  return "us";
}

const isRemoteWord = (s: string) => /^(remote|anywhere|wfh)\b/i.test(s.trim());

/**
 * Build the query list. JSearch takes natural language, so "Data Analyst in
 * Austin, TX" is the right shape. We pair each target title with each
 * location and cap the total, because every query costs a request.
 */
export function buildQueries(prefs: Preferences): SearchQuery[] {
  const titles = prefs.targetTitles.map((t) => t.trim()).filter(Boolean);
  const locations = prefs.locations.map((l) => l.trim()).filter(Boolean);
  const employmentTypes = Array.from(
    new Set(
      prefs.jobTypes
        .map((t) => EMPLOYMENT_TYPE_MAP[t])
        .filter((v): v is string => Boolean(v)),
    ),
  );
  const country = countryFor(locations);
  const wantsRemote =
    prefs.workModes.includes("remote") && !prefs.workModes.includes("onsite");

  if (!titles.length) return [];

  const queries: SearchQuery[] = [];
  const effectiveLocations = locations.length ? locations : ["Remote"];

  for (const title of titles) {
    for (const location of effectiveLocations) {
      if (queries.length >= MAX_QUERIES_PER_SEARCH) break;
      const remote = isRemoteWord(location);
      queries.push({
        query: remote ? `${title} remote` : `${title} in ${location}`,
        // Only hard-filter to remote when the user excluded onsite entirely;
        // otherwise a remote-only filter would hide hybrid roles they want.
        remoteOnly: remote && wantsRemote,
        employmentTypes,
        country,
        numPages: 1,
      });
    }
    if (queries.length >= MAX_QUERIES_PER_SEARCH) break;
  }
  return queries;
}

export interface RecencyOutcome {
  kept: Job[];
  droppedTooOld: number;
  droppedUndated: number;
}

/**
 * Keep only postings we can PROVE are inside the window. A posting with no
 * date is dropped, not assumed fresh - the whole point of the filter is that
 * the user is not sent at month-old listings.
 */
export function filterRecent(jobs: Job[], maxAgeDays: number): RecencyOutcome {
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  let droppedTooOld = 0;
  let droppedUndated = 0;
  const kept: Job[] = [];
  for (const job of jobs) {
    if (!job.postedAt) {
      droppedUndated++;
      continue;
    }
    const posted = new Date(job.postedAt).getTime();
    if (Number.isNaN(posted)) {
      droppedUndated++;
      continue;
    }
    if (posted < cutoff) {
      droppedTooOld++;
      continue;
    }
    kept.push(job);
  }
  return { kept, droppedTooOld, droppedUndated };
}

export interface DedupeOutcome {
  jobs: Job[];
  collapsed: number;
}

/**
 * Collapse the same role posted on several boards into one row, keeping the
 * best version: a direct-to-employer apply link beats a board link, and a
 * longer description beats a truncated one. Boards we saw it on are merged
 * into alsoSeenOn so the UI can say where else it appeared.
 */
export function dedupeJobs(jobs: Job[]): DedupeOutcome {
  const byKey = new Map<string, Job>();
  let collapsed = 0;

  for (const job of jobs) {
    const key = job.dedupeKey || dedupeKeyFor(job.company, job.title);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...job, alsoSeenOn: [...(job.alsoSeenOn ?? [])] });
      continue;
    }
    collapsed++;

    const merged = new Set([
      ...(existing.alsoSeenOn ?? []),
      ...(job.alsoSeenOn ?? []),
    ]);

    // Decide which record to keep as the primary.
    const preferNew =
      (job.applyIsDirect && !existing.applyIsDirect) ||
      (job.applyIsDirect === existing.applyIsDirect &&
        job.description.length > existing.description.length);

    const primary = preferNew ? job : existing;
    const other = preferNew ? existing : job;

    byKey.set(key, {
      ...primary,
      // Keep the earliest known posting date: that is when the role opened.
      postedAt:
        primary.postedAt && other.postedAt
          ? new Date(primary.postedAt) < new Date(other.postedAt)
            ? primary.postedAt
            : other.postedAt
          : (primary.postedAt ?? other.postedAt),
      salaryMin: primary.salaryMin ?? other.salaryMin,
      salaryMax: primary.salaryMax ?? other.salaryMax,
      salaryPeriod: primary.salaryPeriod ?? other.salaryPeriod,
      salaryCurrency: primary.salaryCurrency ?? other.salaryCurrency,
      workMode: primary.workMode ?? other.workMode,
      alsoSeenOn: [...merged],
    });
  }

  return { jobs: [...byKey.values()], collapsed };
}

/** Drop postings whose title the user explicitly does not want. */
export function applyExclusions(jobs: Job[], prefs: Preferences): {
  jobs: Job[];
  excluded: number;
} {
  const badTitles = prefs.excludeTitles
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const badCompanies = prefs.excludeCompanies
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  if (!badTitles.length && !badCompanies.length) return { jobs, excluded: 0 };

  const kept = jobs.filter((job) => {
    const title = job.title.toLowerCase();
    const company = job.company.toLowerCase();
    if (badTitles.some((t) => title.includes(t))) return false;
    if (badCompanies.some((c) => company.includes(c))) return false;
    return true;
  });
  return { jobs: kept, excluded: jobs.length - kept.length };
}

export interface SearchOutcome {
  jobs: Job[];
  stats: {
    fetched: number;
    droppedTooOld: number;
    droppedUndated: number;
    collapsedDuplicates: number;
    excludedByPreference: number;
    requestsUsed: number;
    quotaRemaining: number | null;
  };
  warnings: string[];
  queries: string[];
}

export async function runSearch(prefs: Preferences): Promise<SearchOutcome> {
  const queries = buildQueries(prefs);
  if (!queries.length) {
    return {
      jobs: [],
      stats: {
        fetched: 0,
        droppedTooOld: 0,
        droppedUndated: 0,
        collapsedDuplicates: 0,
        excludedByPreference: 0,
        requestsUsed: 0,
        quotaRemaining: null,
      },
      warnings: [
        "No target job titles set. Add at least one on the preferences " +
          "screen - the search needs something to look for.",
      ],
      queries: [],
    };
  }

  const result: SourceResult =
    config.jobSource === "mock"
      ? await searchMock(queries)
      : await searchJSearch(queries);

  const fetched = result.jobs.length;
  const recency = filterRecent(result.jobs, config.maxJobAgeDays);
  const deduped = dedupeJobs(recency.kept);
  const excluded = applyExclusions(deduped.jobs, prefs);

  return {
    jobs: excluded.jobs,
    stats: {
      fetched,
      droppedTooOld: recency.droppedTooOld,
      droppedUndated: recency.droppedUndated,
      collapsedDuplicates: deduped.collapsed,
      excludedByPreference: excluded.excluded,
      requestsUsed: result.requestsUsed,
      quotaRemaining: result.quotaRemaining,
    },
    warnings: result.warnings,
    queries: queries.map((q) => q.query),
  };
}
