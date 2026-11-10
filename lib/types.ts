// ---------------------------------------------------------------------------
// Core domain types.  These are the contract between the parser, the job
// sources, the matcher, the tailorer and the UI.
// ---------------------------------------------------------------------------

export type WorkMode = "remote" | "hybrid" | "onsite";

export type JobType =
  | "fulltime"
  | "parttime"
  | "contract"
  | "internship"
  | "temporary";

export type Seniority =
  | "intern"
  | "entry"
  | "mid"
  | "senior"
  | "staff"
  | "principal"
  | "manager"
  | "director"
  | "executive";

/** One job held, as read off the resume. */
export interface ResumeRole {
  title: string;
  company: string;
  /** Free text as written on the resume, e.g. "Mar 2021" or "2021-03". */
  startDate: string;
  /** Free text; "Present" is normal. */
  endDate: string;
  location: string;
  /** The achievement bullets, verbatim. These are what tailoring reorders. */
  bullets: string[];
}

export interface ResumeEducation {
  degree: string;
  field: string;
  school: string;
  /** Graduation year, or "" when the resume omits it. */
  year: string;
}

/**
 * Everything derived FROM the resume. Every field is editable in the UI
 * because extraction is good but not perfect, and a wrong profile poisons
 * both search and tailoring.
 */
export interface ResumeProfile {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  /** LinkedIn, GitHub, portfolio, etc. */
  links: string[];
  summary: string;
  roles: ResumeRole[];
  /** Computed by the model from the role dates, then user-correctable. */
  yearsExperience: number;
  skills: string[];
  tools: string[];
  industries: string[];
  education: ResumeEducation[];
  certifications: string[];
  /** Highest seniority the resume actually evidences. */
  seniority: Seniority | "";
}

/**
 * The pre-screen answers: things a resume does NOT say. Collected before the
 * first search, and the main reason search results are any good.
 */
export interface Preferences {
  targetTitles: string[];
  /** Titles to actively filter out, e.g. "Sales Engineer". */
  excludeTitles: string[];
  seniority: Seniority[];
  /** "Remote", "Austin, TX", "United Kingdom" — passed to the job API. */
  locations: string[];
  workModes: WorkMode[];
  jobTypes: JobType[];
  salaryFloor: number | null;
  salaryCurrency: string;
  /** Free text, e.g. "US citizen", "needs H-1B transfer". */
  workAuthorization: string;
  needsSponsorship: boolean | null;
  willingToRelocate: boolean;
  /** "Immediately", "2 weeks notice", a date — whatever the user types. */
  earliestStart: string;
  companySizes: string[];
  excludeCompanies: string[];
  /** Anything else worth telling the matcher. Free text, goes into the prompt. */
  notes: string;
}

/** The persisted profile: resume-derived plus pre-screen, plus provenance. */
export interface Profile {
  resume: ResumeProfile;
  preferences: Preferences;
  resumeFilename: string | null;
  /** Absolute path on disk to the uploaded .docx. */
  resumePath: string | null;
  /** Plain text of the resume, kept for tailoring and prefiltering. */
  resumeText: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  /** Stable content hash — the primary key. */
  id: string;
  source: string;
  sourceJobId: string;
  title: string;
  company: string;
  location: string;
  workMode: WorkMode | null;
  /** ISO 8601. null when the source did not say, which means we cannot
   *  honour the recency filter and the job is dropped. */
  postedAt: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  /** "year" | "hour" | "month" | null */
  salaryPeriod: string | null;
  salaryCurrency: string | null;
  jobType: string | null;
  description: string;
  applyUrl: string;
  /** True when applyUrl goes to the employer's own ATS rather than a board. */
  applyIsDirect: boolean;
  /** Normalised company+title, used to collapse cross-board duplicates. */
  dedupeKey: string;
  fetchedAt: string;
  /** Other boards the same role was found on. */
  alsoSeenOn?: string[];
}

export interface Match {
  jobId: string;
  /** 0-100. */
  score: number;
  /** Why this matched — shown in the UI, never invented. */
  reasons: string[];
  /** What the posting wants that the resume does not evidence. */
  gaps: string[];
  scoredBy: "claude" | "prefilter";
  scoredAt: string;
  /** The cheap overlap score that got it into the scoring shortlist. */
  prefilterScore: number;
}

export type ApplicationStatus =
  | "new"
  | "saved"
  | "tailored"
  | "applied"
  | "interviewing"
  | "rejected"
  | "dismissed";

export interface Application {
  jobId: string;
  status: ApplicationStatus;
  notes: string;
  appliedAt: string | null;
  updatedAt: string;
}

/** One paragraph-level edit the tailorer proposes. */
export interface TailorChange {
  /** Index into the extracted paragraph list. */
  paragraphIndex: number;
  before: string;
  after: string;
  /** Why this edit helps for this posting. */
  why: string;
}

export interface Tailoring {
  id: number;
  jobId: string;
  model: string;
  /** Prose summary of the strategy taken. */
  summary: string;
  changes: TailorChange[];
  /** Keywords from the posting that the resume already supported. */
  emphasised: string[];
  /** Requirements the resume genuinely cannot support — surfaced, not faked. */
  notAddressed: string[];
  docxPath: string | null;
  createdAt: string;
}

/** A generated cover letter, as written to an application folder. */
export interface CoverLetterExport {
  /** The rendered letter, ready to paste or print. */
  text: string;
  /** Every factual claim the letter makes, for the user to verify. */
  claimsMade: string[];
  /** Claims whose terms could not be traced back to the resume. */
  unverifiable: string[];
}

/** A single metered call, for the usage display. */
export interface UsageRow {
  id: number;
  ts: string;
  kind: "claude" | "jsearch";
  detail: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  model: string | null;
  mocked: boolean;
}

export interface UsageSummary {
  month: string;
  jsearch: {
    requests: number;
    quota: number;
    overageRequests: number;
    overageUsd: number;
  };
  claude: {
    usd: number;
    cap: number;
    inputTokens: number;
    outputTokens: number;
    callCount: number;
    capReached: boolean;
  };
}
