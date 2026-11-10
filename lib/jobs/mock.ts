import crypto from "node:crypto";
import { logUsage } from "../db";
import type { Job } from "../types";
import { dedupeKeyFor, type SearchQuery, type SourceResult } from "./jsearch";

// ---------------------------------------------------------------------------
// Fixtures for JOB_SOURCE=mock.
//
// Deliberately NOT a flat list of canned rows: titles are derived from the
// user's own target titles so mock mode exercises ranking against their real
// profile. The set also plants three things worth testing:
//
//   * two postings of the SAME role on different boards  -> dedupe
//   * two postings older than 14 days                    -> recency filter
//   * one posting with no date at all                     -> must be dropped
// ---------------------------------------------------------------------------

interface Seed {
  titlePattern: string;
  company: string;
  location: string;
  remote: boolean;
  daysAgo: number | null;
  salary: [number, number] | null;
  publisher: string;
  blurb: string;
  /** Set when this intentionally duplicates another seed. */
  duplicateOf?: string;
}

const SEEDS: Seed[] = [
  {
    titlePattern: "Senior {role}",
    company: "Northwind Analytics",
    location: "Remote (US)",
    remote: true,
    daysAgo: 2,
    salary: [120000, 155000],
    publisher: "LinkedIn",
    blurb:
      "We are hiring a senior individual contributor to own our reporting " +
      "layer end to end. You will partner with finance and operations, model " +
      "data in dbt, and ship dashboards the whole company reads daily.\n\n" +
      "Qualifications:\n- 5+ years in an analytics or data role\n" +
      "- Strong SQL and Python\n- Experience with dbt, Airflow or similar\n" +
      "- Comfortable presenting to executives",
  },
  {
    titlePattern: "Senior {role}",
    company: "Northwind Analytics",
    location: "Remote",
    remote: true,
    daysAgo: 3,
    salary: [120000, 155000],
    publisher: "Indeed",
    blurb: "Cross-posted listing for the same opening.",
    duplicateOf: "Northwind Analytics",
  },
  {
    titlePattern: "{role}",
    company: "Brightline Health",
    location: "Austin, TX",
    remote: false,
    daysAgo: 5,
    salary: [95000, 120000],
    publisher: "Greenhouse",
    blurb:
      "Join a six-person data team supporting clinical operations. This is a " +
      "hybrid role, three days a week onsite in Austin.\n\n" +
      "Qualifications:\n- 3+ years analysing operational data\n" +
      "- SQL fluency; Python or R a plus\n- Healthcare experience welcome " +
      "but not required",
  },
  {
    titlePattern: "Staff {role}",
    company: "Vector Logistics",
    location: "Chicago, IL",
    remote: true,
    daysAgo: 1,
    salary: [150000, 190000],
    publisher: "Lever",
    blurb:
      "Staff-level role setting technical direction for analytics across " +
      "three business units. You will mentor analysts and own our metrics " +
      "definitions.\n\nQualifications:\n- 8+ years experience\n" +
      "- Track record leading without formal authority\n" +
      "- Deep warehouse modelling experience (Snowflake or BigQuery)",
  },
  {
    titlePattern: "{role} II",
    company: "Cobalt Retail Group",
    location: "Remote (US)",
    remote: true,
    daysAgo: 9,
    salary: [85000, 105000],
    publisher: "ZipRecruiter",
    blurb:
      "Mid-level opening on our merchandising analytics team. Heavy " +
      "Excel and SQL, with a migration to Looker underway.\n\n" +
      "Qualifications:\n- 2-4 years experience\n- Advanced Excel\n" +
      "- SQL; BI tool experience",
  },
  {
    titlePattern: "Lead {role}",
    company: "Harbor Point Capital",
    location: "New York, NY",
    remote: false,
    daysAgo: 12,
    salary: [160000, 210000],
    publisher: "Ashby",
    blurb:
      "Onsite five days a week in Manhattan. Leading a team of four. " +
      "Financial services background strongly preferred.\n\n" +
      "Qualifications:\n- 7+ years, including 2+ managing\n" +
      "- Series 7 a plus\n- Python, SQL, and strong stakeholder skills",
  },
  {
    titlePattern: "Junior {role}",
    company: "Sunset Media",
    location: "Los Angeles, CA",
    remote: true,
    daysAgo: 6,
    salary: [62000, 75000],
    publisher: "Workable",
    blurb:
      "Entry-level role for someone starting out. Training provided.\n\n" +
      "Qualifications:\n- 0-2 years experience\n- Curiosity and care\n" +
      "- Any SQL exposure",
  },
  {
    titlePattern: "Director of {role}",
    company: "Atlas Manufacturing",
    location: "Detroit, MI",
    remote: false,
    daysAgo: 4,
    salary: [185000, 230000],
    publisher: "LinkedIn",
    blurb:
      "Own the analytics function for a 4,000-person manufacturer. Reports " +
      "to the CFO.\n\nQualifications:\n- 10+ years, 5+ leading teams\n" +
      "- Budget ownership\n- Manufacturing or supply chain background",
  },
  {
    titlePattern: "Contract {role}",
    company: "Pine & Rowe Consulting",
    location: "Remote",
    remote: true,
    daysAgo: 7,
    salary: [70, 95],
    publisher: "Indeed",
    blurb:
      "Six-month contract, possible extension. Hourly W2.\n\n" +
      "Qualifications:\n- 4+ years\n- Able to start within two weeks",
  },
  {
    titlePattern: "Sales Engineer",
    company: "Quantum Software",
    location: "Remote (US)",
    remote: true,
    daysAgo: 3,
    salary: [110000, 140000],
    publisher: "LinkedIn",
    blurb:
      "Technical pre-sales role. Heavy travel, 40%. Included so you can see " +
      "how an off-target posting is scored and why.\n\n" +
      "Qualifications:\n- Customer-facing experience\n- Comfort with demos",
  },
  // --- these two must be filtered out by the 14-day rule ---
  {
    titlePattern: "Senior {role}",
    company: "Old Post Industries",
    location: "Remote",
    remote: true,
    daysAgo: 23,
    salary: [115000, 145000],
    publisher: "Indeed",
    blurb: "Posted over three weeks ago; should never reach the results list.",
  },
  {
    titlePattern: "{role}",
    company: "Stale Holdings",
    location: "Boston, MA",
    remote: false,
    daysAgo: 45,
    salary: null,
    publisher: "Monster",
    blurb: "Posted six weeks ago; should never reach the results list.",
  },
  // --- no posting date at all: must be dropped, not assumed recent ---
  {
    titlePattern: "{role}",
    company: "Undated Ventures",
    location: "Remote",
    remote: true,
    daysAgo: null,
    salary: null,
    publisher: "Unknown Board",
    blurb:
      "No posting date. We cannot prove it is under 14 days old, so it is " +
      "discarded rather than shown with a guess.",
  },
];

/** Pull a usable role noun out of the search query, e.g.
 *  "Senior Data Analyst in Austin, TX" -> "Data Analyst". */
function roleFromQuery(query: string): string {
  const withoutLocation = query.split(/\sin\s/i)[0];
  const cleaned = withoutLocation
    .replace(
      /\b(senior|sr\.?|junior|jr\.?|staff|principal|lead|director of|head of|contract|remote|jobs?)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "Analyst";
}

export async function searchMock(
  queries: SearchQuery[],
): Promise<SourceResult> {
  const role = roleFromQuery(queries[0]?.query ?? "Analyst");
  const now = Date.now();

  const jobs: Job[] = SEEDS.map((seed) => {
    const title = seed.titlePattern.replace("{role}", role);
    const postedAt =
      seed.daysAgo === null
        ? null
        : new Date(now - seed.daysAgo * 86_400_000).toISOString();
    const hourly = seed.salary !== null && seed.salary[1] < 1000;
    return {
      id: crypto
        .createHash("sha256")
        .update(`mock:${seed.company}:${title}:${seed.publisher}`)
        .digest("hex")
        .slice(0, 24),
      source: "mock",
      sourceJobId: `MOCK_${normaliseForId(seed.company)}`,
      title,
      company: seed.company,
      location: seed.location,
      workMode: seed.remote
        ? ("remote" as const)
        : /hybrid/i.test(seed.blurb)
          ? ("hybrid" as const)
          : ("onsite" as const),
      postedAt,
      salaryMin: seed.salary?.[0] ?? null,
      salaryMax: seed.salary?.[1] ?? null,
      salaryPeriod: seed.salary ? (hourly ? "hour" : "year") : null,
      salaryCurrency: seed.salary ? "USD" : null,
      jobType: /contract/i.test(title) ? "Contractor" : "Full-time",
      description: `${seed.blurb}\n\n[This is sample data from JOB_SOURCE=mock. No API was called.]`,
      applyUrl: `https://example.invalid/apply/${normaliseForId(
        seed.company,
      )}/${normaliseForId(title)}`,
      applyIsDirect: ["Greenhouse", "Lever", "Ashby", "Workable"].includes(
        seed.publisher,
      ),
      dedupeKey: dedupeKeyFor(seed.company, title),
      fetchedAt: new Date().toISOString(),
      alsoSeenOn: [seed.publisher],
    };
  });

  logUsage({
    kind: "jsearch",
    detail: `mock search: ${queries.map((q) => q.query).join(" | ")}`,
    requests: queries.length,
    mocked: true,
  });

  return {
    jobs,
    requestsUsed: 0,
    quotaLimit: null,
    quotaRemaining: null,
    warnings: [
      "JOB_SOURCE=mock - these are sample postings, not real openings. " +
        "Set JOB_SOURCE and a key in .env.local for live results.",
    ],
  };
}

function normaliseForId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
