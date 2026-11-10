import crypto from "node:crypto";
import { config } from "../config";
import { logUsage } from "../db";
import type { Job, WorkMode } from "../types";

// ---------------------------------------------------------------------------
// JSearch adapter.
//
// JSearch is published by OpenWeb Ninja and sold two ways: through the
// RapidAPI marketplace, and direct. Same data, same parameters, different
// host and auth header - so one adapter covers both.
//
//   jsearch-rapidapi : https://jsearch.p.rapidapi.com  + x-rapidapi-key
//   jsearch-direct   : base URL from your OpenWeb Ninja dashboard + x-api-key
//
// The direct base URL is NOT hardcoded because OpenWeb Ninja's public agent
// storefront does not document a plain REST host; set JSEARCH_DIRECT_BASE_URL
// from your dashboard if you buy direct.
// ---------------------------------------------------------------------------

export interface SearchQuery {
  /** Natural-language query, which is what JSearch expects. */
  query: string;
  remoteOnly: boolean;
  /** FULLTIME, CONTRACTOR, PARTTIME, INTERN */
  employmentTypes: string[];
  /** ISO-3166 alpha-2, lowercase. */
  country: string;
  /** How many result pages to pull. Each page is billed as one request. */
  numPages: number;
}

export interface SourceResult {
  jobs: Job[];
  requestsUsed: number;
  /** Authoritative quota figures from RapidAPI's response headers, when sent. */
  quotaLimit: number | null;
  quotaRemaining: number | null;
  warnings: string[];
}

/** JSearch's date_posted only has these buckets, so we pick the smallest one
 *  that still contains our window and filter precisely afterwards. */
export function datePostedBucket(maxAgeDays: number): string {
  if (maxAgeDays <= 1) return "today";
  if (maxAgeDays <= 3) return "3days";
  if (maxAgeDays <= 7) return "week";
  return "month";
}

interface Endpoint {
  url: string;
  headers: Record<string, string>;
}

function endpoint(): Endpoint {
  if (config.jobSource === "jsearch-direct") {
    const base = (
      process.env.JSEARCH_DIRECT_BASE_URL ?? ""
    ).trim().replace(/\/+$/, "");
    if (!base) {
      throw new Error(
        "JOB_SOURCE=jsearch-direct needs JSEARCH_DIRECT_BASE_URL in " +
          ".env.local - copy the search endpoint from your OpenWeb Ninja " +
          "dashboard. Or use JOB_SOURCE=jsearch-rapidapi.",
      );
    }
    return {
      url: `${base}/search`,
      headers: {
        "x-api-key": config.openWebNinjaApiKey,
        Accept: "application/json",
      },
    };
  }
  return {
    url: `https://${config.rapidApiHost}/search`,
    headers: {
      "x-rapidapi-key": config.rapidApiKey,
      "x-rapidapi-host": config.rapidApiHost,
      Accept: "application/json",
    },
  };
}

// --- response shapes (defensive: JSearch has moved fields between versions) --

interface RawJob {
  job_id?: string;
  employer_name?: string;
  job_title?: string;
  job_apply_link?: string;
  job_apply_is_direct?: boolean;
  apply_options?: { publisher?: string; apply_link?: string; is_direct?: boolean }[];
  job_description?: string;
  job_is_remote?: boolean;
  job_posted_at_datetime_utc?: string | null;
  job_posted_at_timestamp?: number | null;
  job_posted_human_readable?: string | null;
  job_location?: string | null;
  job_city?: string | null;
  job_state?: string | null;
  job_country?: string | null;
  job_employment_type?: string | null;
  job_employment_types?: string[] | null;
  job_min_salary?: number | null;
  job_max_salary?: number | null;
  job_salary_period?: string | null;
  job_salary_currency?: string | null;
  job_salary?: {
    min_salary?: number | null;
    max_salary?: number | null;
    salary_period?: string | null;
    salary_currency?: string | null;
  } | null;
  job_publisher?: string | null;
  job_highlights?: {
    Qualifications?: string[];
    Responsibilities?: string[];
    Benefits?: string[];
  } | null;
}

export function normaliseCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|sa|bv|ag)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    // Drop parenthetical and bracketed noise: "(Remote)", "[US]".
    .replace(/[([{][^)\]}]*[)\]}]/g, " ")
    // Drop requisition ids and trailing location suffixes after a dash.
    .replace(/\b(req|requisition|job)\s*#?\s*\d+\b/g, " ")
    .replace(/\s[-–—|]\s.*$/, " ")
    .replace(/\b(senior|sr|junior|jr|staff|principal|lead|i{1,3}|iv|v|\d+)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function dedupeKeyFor(company: string, title: string): string {
  return `${normaliseCompany(company)}::${normaliseTitle(title)}`;
}

/** Stable id so re-running a search updates rather than duplicates. */
function jobIdFor(source: string, raw: RawJob, applyUrl: string): string {
  const basis =
    raw.job_id ||
    `${raw.employer_name ?? ""}|${raw.job_title ?? ""}|${applyUrl}`;
  return crypto
    .createHash("sha256")
    .update(`${source}:${basis}`)
    .digest("hex")
    .slice(0, 24);
}

function workModeOf(raw: RawJob): WorkMode | null {
  if (raw.job_is_remote === true) return "remote";
  const text = `${raw.job_title ?? ""} ${raw.job_description ?? ""}`.slice(
    0,
    4000,
  );
  if (/\bhybrid\b/i.test(text)) return "hybrid";
  if (/\b(on[-\s]?site|in[-\s]?office|in[-\s]?person)\b/i.test(text)) {
    return "onsite";
  }
  if (raw.job_is_remote === false) return "onsite";
  return null;
}

function postedAtOf(raw: RawJob): string | null {
  if (raw.job_posted_at_datetime_utc) {
    const d = new Date(raw.job_posted_at_datetime_utc);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof raw.job_posted_at_timestamp === "number") {
    // Seconds, not milliseconds.
    const d = new Date(raw.job_posted_at_timestamp * 1000);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function locationOf(raw: RawJob): string {
  if (raw.job_location) return raw.job_location;
  return [raw.job_city, raw.job_state, raw.job_country]
    .filter(Boolean)
    .join(", ");
}

/** Qualifications and responsibilities matter more for matching than the
 *  marketing preamble, so fold them into the text we keep. */
function descriptionOf(raw: RawJob): string {
  const parts = [raw.job_description ?? ""];
  const h = raw.job_highlights;
  if (h?.Qualifications?.length) {
    parts.push(`\n\nQualifications:\n- ${h.Qualifications.join("\n- ")}`);
  }
  if (h?.Responsibilities?.length) {
    parts.push(`\n\nResponsibilities:\n- ${h.Responsibilities.join("\n- ")}`);
  }
  return parts.join("").trim();
}

export function toJob(raw: RawJob, source: string): Job | null {
  const title = (raw.job_title ?? "").trim();
  const company = (raw.employer_name ?? "").trim();
  if (!title || !company) return null;

  // Prefer an apply link that goes straight to the employer's own ATS.
  const direct = raw.apply_options?.find((o) => o.is_direct && o.apply_link);
  const applyUrl = direct?.apply_link ?? raw.job_apply_link ?? "";
  if (!applyUrl) return null;

  const salary = raw.job_salary ?? {};
  return {
    id: jobIdFor(source, raw, applyUrl),
    source,
    sourceJobId: raw.job_id ?? "",
    title,
    company,
    location: locationOf(raw),
    workMode: workModeOf(raw),
    postedAt: postedAtOf(raw),
    salaryMin: raw.job_min_salary ?? salary.min_salary ?? null,
    salaryMax: raw.job_max_salary ?? salary.max_salary ?? null,
    salaryPeriod: raw.job_salary_period ?? salary.salary_period ?? null,
    salaryCurrency: raw.job_salary_currency ?? salary.salary_currency ?? null,
    jobType:
      raw.job_employment_type ?? raw.job_employment_types?.[0] ?? null,
    description: descriptionOf(raw),
    applyUrl,
    applyIsDirect: Boolean(direct?.is_direct ?? raw.job_apply_is_direct),
    dedupeKey: dedupeKeyFor(company, title),
    fetchedAt: new Date().toISOString(),
    alsoSeenOn: raw.job_publisher ? [raw.job_publisher] : [],
  };
}

export async function searchJSearch(
  queries: SearchQuery[],
): Promise<SourceResult> {
  const { url, headers } = endpoint();
  const source = config.jobSource;
  const jobs: Job[] = [];
  const warnings: string[] = [];
  let requestsUsed = 0;
  let quotaLimit: number | null = null;
  let quotaRemaining: number | null = null;

  for (const q of queries) {
    const params = new URLSearchParams({
      query: q.query,
      page: "1",
      num_pages: String(q.numPages),
      date_posted: datePostedBucket(config.maxJobAgeDays),
      country: q.country,
    });
    if (q.remoteOnly) params.set("remote_jobs_only", "true");
    if (q.employmentTypes.length) {
      params.set("employment_types", q.employmentTypes.join(","));
    }

    let response: Response;
    try {
      response = await fetch(`${url}?${params.toString()}`, {
        headers,
        signal: AbortSignal.timeout(45_000),
      });
    } catch (err) {
      warnings.push(
        `"${q.query}" failed to reach the job API: ${(err as Error).message}`,
      );
      continue;
    }

    // Each requested page is billed as a request, whether or not it had data.
    requestsUsed += q.numPages;
    logUsage({
      kind: "jsearch",
      detail: q.query,
      requests: q.numPages,
      mocked: false,
    });

    const limitHeader = response.headers.get("x-ratelimit-requests-limit");
    const remainingHeader = response.headers.get(
      "x-ratelimit-requests-remaining",
    );
    if (limitHeader) quotaLimit = Number(limitHeader);
    if (remainingHeader) quotaRemaining = Number(remainingHeader);

    if (response.status === 429) {
      warnings.push(
        "The job API rate-limited this search. Your plan's monthly request " +
          "allowance may be used up; the rest of the results are missing.",
      );
      break;
    }
    if (response.status === 401 || response.status === 403) {
      warnings.push(
        "The job API rejected the key. Check RAPIDAPI_KEY in .env.local and " +
          "that you are subscribed to JSearch.",
      );
      break;
    }
    if (!response.ok) {
      warnings.push(
        `"${q.query}" returned HTTP ${response.status} from the job API.`,
      );
      continue;
    }

    let payload: { data?: RawJob[]; status?: string };
    try {
      payload = (await response.json()) as { data?: RawJob[] };
    } catch {
      warnings.push(`"${q.query}" returned a response that was not JSON.`);
      continue;
    }

    for (const raw of payload.data ?? []) {
      const job = toJob(raw, source);
      if (job) jobs.push(job);
    }
  }

  return { jobs, requestsUsed, quotaLimit, quotaRemaining, warnings };
}
