// Throwaway: exercise query building, the 14-day filter, dedupe and exclusions.
import {
  applyExclusions,
  buildQueries,
  dedupeJobs,
  filterRecent,
} from "../lib/jobs/index";
import { searchMock } from "../lib/jobs/mock";
import {
  datePostedBucket,
  dedupeKeyFor,
  normaliseTitle,
  toJob,
} from "../lib/jobs/jsearch";
import type { Preferences } from "../lib/types";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`        expected: ${JSON.stringify(expected)}`);
    console.log(`        actual:   ${JSON.stringify(actual)}`);
    failures++;
  }
}

const prefs: Preferences = {
  targetTitles: ["Data Analyst", "Analytics Engineer"],
  excludeTitles: [],
  seniority: ["mid", "senior"],
  locations: ["Remote", "Austin, TX"],
  workModes: ["remote", "hybrid"],
  jobTypes: ["fulltime", "contract"],
  salaryFloor: 100000,
  salaryCurrency: "USD",
  workAuthorization: "US citizen",
  needsSponsorship: false,
  willingToRelocate: false,
  earliestStart: "2 weeks",
  companySizes: [],
  excludeCompanies: [],
  notes: "",
};

async function main() {
  // --- query building ---
  const queries = buildQueries(prefs);
  console.log("--- queries ---");
  queries.forEach((q) =>
    console.log(`  ${JSON.stringify(q.query)} remoteOnly=${q.remoteOnly} types=${q.employmentTypes.join(",")} country=${q.country}`),
  );
  check("capped at 4 queries", queries.length, 4);
  check("remote query phrased for remote", queries[0].query, "Data Analyst remote");
  check("located query uses 'in'", queries[1].query, "Data Analyst in Austin, TX");
  check(
    "employment types mapped",
    queries[0].employmentTypes,
    ["FULLTIME", "CONTRACTOR"],
  );
  check("country inferred as us", queries[0].country, "us");
  check(
    "remoteOnly off because hybrid is wanted too",
    queries[0].remoteOnly,
    true,
  );

  // UK inference
  check(
    "UK location infers gb",
    buildQueries({ ...prefs, locations: ["London, United Kingdom"] })[0].country,
    "gb",
  );
  check("no titles means no queries", buildQueries({ ...prefs, targetTitles: [] }).length, 0);

  // --- date bucket mapping ---
  check("14 days maps to month bucket", datePostedBucket(14), "month");
  check("3 days maps to 3days", datePostedBucket(3), "3days");
  check("7 days maps to week", datePostedBucket(7), "week");

  // --- title normalisation / dedupe keys ---
  check(
    "seniority and req ids stripped from title",
    normaliseTitle("Senior Data Analyst II (Remote) - Req #12345"),
    "data analyst",
  );
  check(
    "same role different decoration dedupes alike",
    dedupeKeyFor("Northwind Analytics, Inc.", "Senior Data Analyst (Remote)"),
    dedupeKeyFor("Northwind Analytics", "Data Analyst"),
  );

  // --- the pipeline over mock data ---
  const { jobs: raw } = await searchMock(queries);
  console.log(`\n--- fetched ${raw.length} mock postings ---`);

  const recency = filterRecent(raw, 14);
  check("two postings dropped as too old", recency.droppedTooOld, 2);
  check("one undated posting dropped", recency.droppedUndated, 1);
  const names = recency.kept.map((j) => j.company);
  check(
    "stale companies gone",
    names.filter((n) => ["Old Post Industries", "Stale Holdings", "Undated Ventures"].includes(n)),
    [],
  );

  const deduped = dedupeJobs(recency.kept);
  check("one duplicate collapsed", deduped.collapsed, 1);
  const northwind = deduped.jobs.filter((j) => j.company === "Northwind Analytics");
  check("Northwind appears once", northwind.length, 1);
  check(
    "both boards recorded on the survivor",
    [...(northwind[0].alsoSeenOn ?? [])].sort(),
    ["Indeed", "LinkedIn"],
  );
  check(
    "earliest posting date kept for the merged role",
    Math.round(
      (Date.now() - new Date(northwind[0].postedAt!).getTime()) / 86_400_000,
    ),
    3,
  );

  // --- exclusions ---
  const beforeExclusion = deduped.jobs.length;
  const excluded = applyExclusions(deduped.jobs, {
    ...prefs,
    excludeTitles: ["Sales Engineer"],
    excludeCompanies: ["Harbor Point"],
  });
  check("two postings excluded by preference", excluded.excluded, 2);
  check(
    "Sales Engineer gone",
    excluded.jobs.some((j) => j.title.includes("Sales Engineer")),
    false,
  );
  check(
    "excluded company gone",
    excluded.jobs.some((j) => j.company.includes("Harbor Point")),
    false,
  );
  check("other postings untouched", excluded.jobs.length, beforeExclusion - 2);

  // --- JSearch response mapping ---
  const mapped = toJob(
    {
      job_id: "abc123",
      employer_name: "Acme Corp",
      job_title: "Data Analyst",
      job_apply_link: "https://board.example/apply/1",
      apply_options: [
        { publisher: "Indeed", apply_link: "https://board.example/apply/1", is_direct: false },
        { publisher: "Greenhouse", apply_link: "https://acme.greenhouse.io/jobs/1", is_direct: true },
      ],
      job_description: "Analyse things.",
      job_is_remote: true,
      job_posted_at_timestamp: Math.floor(Date.now() / 1000) - 86_400,
      job_city: "Austin",
      job_state: "TX",
      job_country: "US",
      job_min_salary: 100000,
      job_max_salary: 130000,
      job_salary_period: "YEAR",
      job_salary_currency: "USD",
      job_publisher: "Indeed",
      job_highlights: { Qualifications: ["SQL", "Python"] },
    },
    "jsearch-rapidapi",
  );
  check("mapped job prefers the direct ATS link", mapped?.applyUrl, "https://acme.greenhouse.io/jobs/1");
  check("mapped job flagged as direct", mapped?.applyIsDirect, true);
  check("remote detected", mapped?.workMode, "remote");
  check("location assembled from parts", mapped?.location, "Austin, TX, US");
  check(
    "qualifications folded into description",
    mapped?.description.includes("Qualifications:\n- SQL\n- Python"),
    true,
  );
  check(
    "unix timestamp converted to a recent ISO date",
    Math.round((Date.now() - new Date(mapped!.postedAt!).getTime()) / 3_600_000),
    24,
  );
  check(
    "a posting with no title is rejected",
    toJob({ employer_name: "X", job_apply_link: "https://x" }, "jsearch-rapidapi"),
    null,
  );
  check(
    "a posting with no apply link is rejected",
    toJob({ employer_name: "X", job_title: "Y" }, "jsearch-rapidapi"),
    null,
  );

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
