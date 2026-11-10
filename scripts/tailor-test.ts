// Throwaway: the anti-fabrication guard and the editable-paragraph filter.
import {
  editableParagraphs,
  knownTermsIn,
  numbersIn,
  vetEdit,
  wordDiff,
} from "../lib/tailor";
import { EMPTY_RESUME_PROFILE } from "../lib/resume";
import type { Profile } from "../lib/types";
import type { DocxParagraph } from "../lib/docx";

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

const RESUME_TEXT = `Dana Whitfield
dana@example.com
EXPERIENCE
Senior Data Analyst, Northwind Analytics
Built reports for the finance team, cutting close time by 30%
Managed a team of 4 analysts across 2 regions
Used SQL and Python to automate 15 recurring reports
SKILLS
SQL, Python, Excel, Tableau`;

const numbers = numbersIn(RESUME_TEXT);
const nouns = knownTermsIn(RESUME_TEXT);

console.log("--- anti-fabrication guard ---");

// 1. Legitimate reword: same facts, posting's vocabulary.
const ok1 = vetEdit(
  "Built reports for the finance team, cutting close time by 30%",
  "Built self-serve reporting for finance, cutting close time by 30%",
  "mirrors the posting's 'self-serve reporting'",
  4,
  numbers,
  nouns,
);
check("legitimate reword accepted", ok1.rejected, false);
check("legitimate reword has no problems", ok1.problems, []);

// 2. Invented metric: must be REJECTED, not warned.
const bad1 = vetEdit(
  "Built reports for the finance team, cutting close time by 30%",
  "Built reports for the finance team, cutting close time by 45% and saving $2M",
  "sounds more impressive",
  4,
  numbers,
  nouns,
);
check("invented figures rejected", bad1.rejected, true);
check(
  "invented figures named in the problem",
  bad1.problems.some((p) => p.includes("45")),
  true,
);
check(
  "a currency magnitude is caught even though a bare 2 exists in the resume",
  bad1.problems.some((p) => p.toLowerCase().includes("2m")),
  true,
);

// 2b. The specific hole that number-only matching leaves open.
const bad1b = vetEdit(
  "Managed a team of 4 analysts across 2 regions",
  "Managed a team of 4 analysts across 2 regions, owning a $2M budget",
  "adds scope",
  5,
  numbers,
  nouns,
);
check("invented $2M budget rejected", bad1b.rejected, true);

// 3. Dropping a real figure: also a rejection.
const bad2 = vetEdit(
  "Managed a team of 4 analysts across 2 regions",
  "Managed a team of analysts across multiple regions",
  "smoother wording",
  5,
  numbers,
  nouns,
);
check("dropping real figures rejected", bad2.rejected, true);
check(
  "dropped figures reported",
  bad2.problems.some((p) => p.includes("drops figures")),
  true,
);

// 4. A tool the resume never mentions: warning, not rejection.
const warn1 = vetEdit(
  "Used SQL and Python to automate 15 recurring reports",
  "Used SQL, Python and Looker to automate 15 recurring reports",
  "posting asks for Looker",
  6,
  numbers,
  nouns,
);
check("unseen tool is not rejected", warn1.rejected, false);
check(
  "unseen tool is warned about",
  warn1.warnings.some((w) => w.toLowerCase().includes("looker")),
  true,
);

// 5. Known tools are not flagged.
const ok2 = vetEdit(
  "Used SQL and Python to automate 15 recurring reports",
  "Automated 15 recurring reports with SQL and Python",
  "leads with the achievement",
  6,
  numbers,
  nouns,
);
check("reordering with known tools is clean", ok2.rejected, false);
check("no spurious warnings for known tools", ok2.warnings, []);

// 6. Comma-formatted and percentage figures normalise correctly.
const ok3 = vetEdit(
  "Processed 15 reports covering 30% of revenue",
  "Processed 15 reports covering 30% of total revenue",
  "clarity",
  7,
  numbers,
  nouns,
);
check("percent and plain forms match", ok3.rejected, false);

// 7. Runaway length is warned.
const warn2 = vetEdit(
  "Built reports for finance",
  "Built an extensive suite of self-serve reporting products for the finance organisation, partnering across teams to deliver measurable improvements in reporting cadence and stakeholder satisfaction",
  "expands detail",
  4,
  numbers,
  nouns,
);
check(
  "over-long rewrite warned",
  warn2.warnings.some((w) => w.includes("longer")),
  true,
);

console.log("\n--- editable paragraph filter ---");

const paragraphs: DocxParagraph[] = [
  { index: 0, text: "Dana Whitfield", empty: false },
  { index: 1, text: "dana@example.com | (512) 555-0134", empty: false },
  { index: 2, text: "https://linkedin.com/in/danawhitfield", empty: false },
  { index: 3, text: "", empty: true },
  { index: 4, text: "EXPERIENCE", empty: false },
  { index: 5, text: "Professional Summary", empty: false },
  { index: 6, text: "Jan 2021 - Present", empty: false },
  {
    index: 7,
    text: "Built reports for the finance team, cutting close time by 30%",
    empty: false,
  },
  {
    index: 8,
    text: "Managed a team of 4 analysts across 2 regions and owned the roadmap",
    empty: false,
  },
  { index: 9, text: "SQL, Python, Excel, Tableau", empty: false },
];

const profile: Profile = {
  resume: {
    ...EMPTY_RESUME_PROFILE,
    fullName: "Dana Whitfield",
    email: "dana@example.com",
    links: ["https://linkedin.com/in/danawhitfield"],
  },
  preferences: {
    targetTitles: [],
    excludeTitles: [],
    seniority: [],
    locations: [],
    workModes: [],
    jobTypes: [],
    salaryFloor: null,
    salaryCurrency: "USD",
    workAuthorization: "",
    needsSponsorship: null,
    willingToRelocate: false,
    earliestStart: "",
    companySizes: [],
    excludeCompanies: [],
    notes: "",
  },
  resumeFilename: "r.docx",
  resumePath: "/tmp/r.docx",
  resumeText: RESUME_TEXT,
  confirmedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const editable = editableParagraphs(paragraphs, profile);
const indices = editable.map((p) => p.index);
console.log(`  editable indices: ${JSON.stringify(indices)}`);
check("name excluded", indices.includes(0), false);
check("contact line excluded", indices.includes(1), false);
check("url excluded", indices.includes(2), false);
check("empty paragraph excluded", indices.includes(3), false);
check("all-caps heading excluded", indices.includes(4), false);
check("title-case heading excluded", indices.includes(5), false);
check("date range excluded", indices.includes(6), false);
check("real bullets included", [indices.includes(7), indices.includes(8)], [true, true]);

console.log("\n--- word diff ---");
const segs = wordDiff(
  "Built reports for the finance team",
  "Built self-serve reporting for the finance team",
);
const added = segs.filter((s) => s.added).map((s) => s.value.trim()).join("|");
const removed = segs.filter((s) => s.removed).map((s) => s.value.trim()).join("|");
console.log(`  added: ${added}`);
console.log(`  removed: ${removed}`);
check("diff detects the substitution", added.includes("self-serve reporting"), true);
check("diff marks the removed word", removed.includes("reports"), true);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
