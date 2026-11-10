import fs from "node:fs";
import Database from "better-sqlite3";
import { config, currentMonth } from "./config";
import type {
  Application,
  ApplicationStatus,
  Job,
  Match,
  Profile,
  Tailoring,
  UsageSummary,
} from "./types";

// ---------------------------------------------------------------------------
// The only module that talks to storage.  Everything else goes through the
// functions below, so moving to Postgres/Turso when this gets deployed means
// reimplementing this file and nothing else.
// ---------------------------------------------------------------------------

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profile (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  resume          TEXT NOT NULL,
  preferences     TEXT NOT NULL,
  resume_filename TEXT,
  resume_path     TEXT,
  resume_text     TEXT,
  confirmed_at    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL,
  source_job_id   TEXT,
  title           TEXT NOT NULL,
  company         TEXT NOT NULL,
  location        TEXT,
  work_mode       TEXT,
  posted_at       TEXT,
  salary_min      REAL,
  salary_max      REAL,
  salary_period   TEXT,
  salary_currency TEXT,
  job_type        TEXT,
  description     TEXT,
  apply_url       TEXT,
  apply_is_direct INTEGER DEFAULT 0,
  dedupe_key      TEXT NOT NULL,
  also_seen_on    TEXT,
  fetched_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_dedupe  ON jobs(dedupe_key);
CREATE INDEX IF NOT EXISTS jobs_posted  ON jobs(posted_at);

CREATE TABLE IF NOT EXISTS matches (
  job_id          TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  score           INTEGER NOT NULL,
  reasons         TEXT NOT NULL,
  gaps            TEXT NOT NULL,
  scored_by       TEXT NOT NULL,
  scored_at       TEXT NOT NULL,
  prefilter_score REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS applications (
  job_id     TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'new',
  notes      TEXT DEFAULT '',
  applied_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tailorings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id         TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  model          TEXT NOT NULL,
  summary        TEXT NOT NULL,
  changes        TEXT NOT NULL,
  emphasised     TEXT NOT NULL,
  not_addressed  TEXT NOT NULL,
  docx_path      TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tailorings_job ON tailorings(job_id);

CREATE TABLE IF NOT EXISTS usage_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL,
  month         TEXT NOT NULL,
  kind          TEXT NOT NULL,
  detail        TEXT DEFAULT '',
  requests      INTEGER DEFAULT 0,
  input_tokens  INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  usd           REAL DEFAULT 0,
  model         TEXT,
  mocked        INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS usage_month ON usage_log(month, kind);
`;

type DbHandle = Database.Database;

// Cached on globalThis so Next's dev-mode hot reload does not open a new
// handle on every edit.
const globalForDb = globalThis as unknown as { __jobhunterDb?: DbHandle };

export function getDb(): DbHandle {
  if (globalForDb.__jobhunterDb) return globalForDb.__jobhunterDb;
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.resumeDir, { recursive: true });
  fs.mkdirSync(config.tailoredDir, { recursive: true });
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  globalForDb.__jobhunterDb = db;
  return db;
}

const nowIso = () => new Date().toISOString();
const j = (v: unknown) => JSON.stringify(v);
function parseArr<T>(raw: unknown, fallback: T[] = []): T[] {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

// --- profile ---------------------------------------------------------------

export function getProfile(): Profile | null {
  const row = getDb().prepare("SELECT * FROM profile WHERE id = 1").get() as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return {
    resume: JSON.parse(row.resume as string),
    preferences: JSON.parse(row.preferences as string),
    resumeFilename: (row.resume_filename as string) ?? null,
    resumePath: (row.resume_path as string) ?? null,
    resumeText: (row.resume_text as string) ?? null,
    confirmedAt: (row.confirmed_at as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function saveProfile(p: Profile): Profile {
  const ts = nowIso();
  getDb()
    .prepare(
      `INSERT INTO profile
         (id, resume, preferences, resume_filename, resume_path, resume_text,
          confirmed_at, created_at, updated_at)
       VALUES (1, @resume, @preferences, @filename, @path, @text,
               @confirmed, @created, @updated)
       ON CONFLICT(id) DO UPDATE SET
         resume = @resume, preferences = @preferences,
         resume_filename = @filename, resume_path = @path, resume_text = @text,
         confirmed_at = @confirmed, updated_at = @updated`,
    )
    .run({
      resume: j(p.resume),
      preferences: j(p.preferences),
      filename: p.resumeFilename,
      path: p.resumePath,
      text: p.resumeText,
      confirmed: p.confirmedAt,
      created: p.createdAt || ts,
      updated: ts,
    });
  return getProfile()!;
}

// --- jobs ------------------------------------------------------------------

function rowToJob(row: Record<string, unknown>): Job {
  return {
    id: row.id as string,
    source: row.source as string,
    sourceJobId: (row.source_job_id as string) ?? "",
    title: row.title as string,
    company: row.company as string,
    location: (row.location as string) ?? "",
    workMode: (row.work_mode as Job["workMode"]) ?? null,
    postedAt: (row.posted_at as string) ?? null,
    salaryMin: (row.salary_min as number) ?? null,
    salaryMax: (row.salary_max as number) ?? null,
    salaryPeriod: (row.salary_period as string) ?? null,
    salaryCurrency: (row.salary_currency as string) ?? null,
    jobType: (row.job_type as string) ?? null,
    description: (row.description as string) ?? "",
    applyUrl: (row.apply_url as string) ?? "",
    applyIsDirect: Boolean(row.apply_is_direct),
    dedupeKey: row.dedupe_key as string,
    alsoSeenOn: parseArr<string>(row.also_seen_on),
    fetchedAt: row.fetched_at as string,
  };
}

/** Insert new jobs, refresh ones already seen. Idempotent: re-running a
 *  search costs nothing extra and never duplicates a row. */
export function upsertJobs(jobs: Job[]): { inserted: number; refreshed: number } {
  const db = getDb();
  const exists = db.prepare("SELECT 1 FROM jobs WHERE id = ?");
  const stmt = db.prepare(
    `INSERT INTO jobs
       (id, source, source_job_id, title, company, location, work_mode,
        posted_at, salary_min, salary_max, salary_period, salary_currency,
        job_type, description, apply_url, apply_is_direct, dedupe_key,
        also_seen_on, fetched_at)
     VALUES (@id, @source, @sourceJobId, @title, @company, @location, @workMode,
             @postedAt, @salaryMin, @salaryMax, @salaryPeriod, @salaryCurrency,
             @jobType, @description, @applyUrl, @applyIsDirect, @dedupeKey,
             @alsoSeenOn, @fetchedAt)
     ON CONFLICT(id) DO UPDATE SET
       description  = @description,
       apply_url    = @applyUrl,
       also_seen_on = @alsoSeenOn,
       fetched_at   = @fetchedAt`,
  );
  let inserted = 0;
  let refreshed = 0;
  const run = db.transaction((batch: Job[]) => {
    for (const job of batch) {
      if (exists.get(job.id)) refreshed++;
      else inserted++;
      stmt.run({
        ...job,
        applyIsDirect: job.applyIsDirect ? 1 : 0,
        alsoSeenOn: j(job.alsoSeenOn ?? []),
      });
    }
  });
  run(jobs);
  return { inserted, refreshed };
}

export function getJob(id: string): Job | null {
  const row = getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToJob(row) : null;
}

export interface JobListItem {
  job: Job;
  match: Match | null;
  application: Application;
}

export function listJobs(
  opts: { status?: ApplicationStatus[]; maxAgeDays?: number; limit?: number } = {},
): JobListItem[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.status?.length) {
    clauses.push(
      `COALESCE(a.status,'new') IN (${opts.status.map(() => "?").join(",")})`,
    );
    params.push(...opts.status);
  }
  if (opts.maxAgeDays) {
    const cutoff = new Date(
      Date.now() - opts.maxAgeDays * 86_400_000,
    ).toISOString();
    clauses.push("jobs.posted_at >= ?");
    params.push(cutoff);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = opts.limit ? `LIMIT ${Number(opts.limit)}` : "";

  const rows = getDb()
    .prepare(
      `SELECT jobs.*,
              m.score, m.reasons, m.gaps, m.scored_by, m.scored_at,
              m.prefilter_score,
              a.status AS app_status, a.notes AS app_notes,
              a.applied_at, a.updated_at AS app_updated
         FROM jobs
         LEFT JOIN matches m      ON m.job_id = jobs.id
         LEFT JOIN applications a ON a.job_id = jobs.id
         ${where}
         ORDER BY COALESCE(m.score, -1) DESC, jobs.posted_at DESC
         ${limit}`,
    )
    .all(...params) as Record<string, unknown>[];

  return rows.map((row) => ({
    job: rowToJob(row),
    match:
      row.score == null
        ? null
        : {
            jobId: row.id as string,
            score: row.score as number,
            reasons: parseArr<string>(row.reasons),
            gaps: parseArr<string>(row.gaps),
            scoredBy: row.scored_by as Match["scoredBy"],
            scoredAt: row.scored_at as string,
            prefilterScore: (row.prefilter_score as number) ?? 0,
          },
    application: {
      jobId: row.id as string,
      status: ((row.app_status as ApplicationStatus) ?? "new"),
      notes: (row.app_notes as string) ?? "",
      appliedAt: (row.applied_at as string) ?? null,
      updatedAt: (row.app_updated as string) ?? (row.fetched_at as string),
    },
  }));
}

// --- matches ---------------------------------------------------------------

export function upsertMatches(matches: Match[]): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO matches
       (job_id, score, reasons, gaps, scored_by, scored_at, prefilter_score)
     VALUES (@jobId, @score, @reasons, @gaps, @scoredBy, @scoredAt, @prefilterScore)
     ON CONFLICT(job_id) DO UPDATE SET
       score = @score, reasons = @reasons, gaps = @gaps,
       scored_by = @scoredBy, scored_at = @scoredAt,
       prefilter_score = @prefilterScore`,
  );
  db.transaction((batch: Match[]) => {
    for (const m of batch) {
      stmt.run({
        ...m,
        reasons: j(m.reasons),
        gaps: j(m.gaps),
      });
    }
  })(matches);
}

export function getMatch(jobId: string): Match | null {
  const row = getDb()
    .prepare("SELECT * FROM matches WHERE job_id = ?")
    .get(jobId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    jobId: row.job_id as string,
    score: row.score as number,
    reasons: parseArr<string>(row.reasons),
    gaps: parseArr<string>(row.gaps),
    scoredBy: row.scored_by as Match["scoredBy"],
    scoredAt: row.scored_at as string,
    prefilterScore: (row.prefilter_score as number) ?? 0,
  };
}

/** Job ids that already carry a Claude score — never pay to score twice. */
export function alreadyScored(jobIds: string[]): Set<string> {
  if (!jobIds.length) return new Set();
  const rows = getDb()
    .prepare(
      `SELECT job_id FROM matches
        WHERE scored_by = 'claude'
          AND job_id IN (${jobIds.map(() => "?").join(",")})`,
    )
    .all(...jobIds) as { job_id: string }[];
  return new Set(rows.map((r) => r.job_id));
}

// --- applications ----------------------------------------------------------

export function setStatus(
  jobId: string,
  status: ApplicationStatus,
  notes?: string,
): Application {
  const ts = nowIso();
  getDb()
    .prepare(
      `INSERT INTO applications (job_id, status, notes, applied_at, updated_at)
       VALUES (@jobId, @status, @notes,
               CASE WHEN @status = 'applied' THEN @ts ELSE NULL END, @ts)
       ON CONFLICT(job_id) DO UPDATE SET
         status = @status,
         notes = COALESCE(@notes, notes),
         applied_at = CASE WHEN @status = 'applied'
                           THEN COALESCE(applied_at, @ts) ELSE applied_at END,
         updated_at = @ts`,
    )
    .run({ jobId, status, notes: notes ?? null, ts });
  return getApplication(jobId)!;
}

export function getApplication(jobId: string): Application | null {
  const row = getDb()
    .prepare("SELECT * FROM applications WHERE job_id = ?")
    .get(jobId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    jobId: row.job_id as string,
    status: row.status as ApplicationStatus,
    notes: (row.notes as string) ?? "",
    appliedAt: (row.applied_at as string) ?? null,
    updatedAt: row.updated_at as string,
  };
}

export function statusCounts(): Record<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT COALESCE(a.status,'new') AS status, COUNT(*) AS n
         FROM jobs LEFT JOIN applications a ON a.job_id = jobs.id
        GROUP BY 1`,
    )
    .all() as { status: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

// --- tailorings ------------------------------------------------------------

export function insertTailoring(
  t: Omit<Tailoring, "id" | "createdAt">,
): Tailoring {
  const ts = nowIso();
  const info = getDb()
    .prepare(
      `INSERT INTO tailorings
         (job_id, model, summary, changes, emphasised, not_addressed,
          docx_path, created_at)
       VALUES (@jobId, @model, @summary, @changes, @emphasised, @notAddressed,
               @docxPath, @createdAt)`,
    )
    .run({
      jobId: t.jobId,
      model: t.model,
      summary: t.summary,
      changes: j(t.changes),
      emphasised: j(t.emphasised),
      notAddressed: j(t.notAddressed),
      docxPath: t.docxPath,
      createdAt: ts,
    });
  return getTailoring(Number(info.lastInsertRowid))!;
}

function rowToTailoring(row: Record<string, unknown>): Tailoring {
  return {
    id: row.id as number,
    jobId: row.job_id as string,
    model: row.model as string,
    summary: row.summary as string,
    changes: parseArr(row.changes),
    emphasised: parseArr<string>(row.emphasised),
    notAddressed: parseArr<string>(row.not_addressed),
    docxPath: (row.docx_path as string) ?? null,
    createdAt: row.created_at as string,
  };
}

export function getTailoring(id: number): Tailoring | null {
  const row = getDb().prepare("SELECT * FROM tailorings WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToTailoring(row) : null;
}

export function latestTailoring(jobId: string): Tailoring | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM tailorings WHERE job_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(jobId) as Record<string, unknown> | undefined;
  return row ? rowToTailoring(row) : null;
}

// --- usage -----------------------------------------------------------------

export function logUsage(entry: {
  kind: "claude" | "jsearch";
  detail?: string;
  requests?: number;
  inputTokens?: number;
  outputTokens?: number;
  usd?: number;
  model?: string | null;
  mocked?: boolean;
}): void {
  const ts = nowIso();
  getDb()
    .prepare(
      `INSERT INTO usage_log
         (ts, month, kind, detail, requests, input_tokens, output_tokens,
          usd, model, mocked)
       VALUES (@ts, @month, @kind, @detail, @requests, @inputTokens,
               @outputTokens, @usd, @model, @mocked)`,
    )
    .run({
      ts,
      month: ts.slice(0, 7),
      kind: entry.kind,
      detail: entry.detail ?? "",
      requests: entry.requests ?? 0,
      inputTokens: entry.inputTokens ?? 0,
      outputTokens: entry.outputTokens ?? 0,
      usd: entry.usd ?? 0,
      model: entry.model ?? null,
      mocked: entry.mocked ? 1 : 0,
    });
}

/** Real (non-mocked) Claude spend for the current calendar month. */
export function claudeSpendThisMonth(): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(usd),0) AS usd FROM usage_log
        WHERE kind = 'claude' AND mocked = 0 AND month = ?`,
    )
    .get(currentMonth()) as { usd: number };
  return row.usd;
}

export function usageSummary(): UsageSummary {
  const month = currentMonth();
  const db = getDb();
  const jobsRow = db
    .prepare(
      `SELECT COALESCE(SUM(requests),0) AS n FROM usage_log
        WHERE kind = 'jsearch' AND mocked = 0 AND month = ?`,
    )
    .get(month) as { n: number };
  const claudeRow = db
    .prepare(
      `SELECT COALESCE(SUM(usd),0) AS usd,
              COALESCE(SUM(input_tokens),0) AS inp,
              COALESCE(SUM(output_tokens),0) AS outp,
              COUNT(*) AS calls
         FROM usage_log
        WHERE kind = 'claude' AND mocked = 0 AND month = ?`,
    )
    .get(month) as { usd: number; inp: number; outp: number; calls: number };

  const requests = jobsRow.n;
  const quota = config.jsearchMonthlyQuota;
  const overageRequests = Math.max(0, requests - quota);

  return {
    month,
    jsearch: {
      requests,
      quota,
      overageRequests,
      overageUsd: overageRequests * config.jsearchOverageUsd,
    },
    claude: {
      usd: claudeRow.usd,
      cap: config.claudeMonthlyUsdCap,
      inputTokens: claudeRow.inp,
      outputTokens: claudeRow.outp,
      callCount: claudeRow.calls,
      capReached: claudeRow.usd >= config.claudeMonthlyUsdCap,
    },
  };
}
