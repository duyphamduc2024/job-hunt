import path from "node:path";

// ---------------------------------------------------------------------------
// All environment handling lives here so nothing else reads process.env.
// Nothing in this file is exposed to the browser (no NEXT_PUBLIC_ anything):
// keys stay server-side, which is also what makes deploying later safe.
// ---------------------------------------------------------------------------

function str(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type JobSourceName = "mock" | "jsearch-rapidapi" | "jsearch-direct";

/**
 * How Claude gets called.
 *   mock - canned fixtures. No network, no cost. The dev default.
 *   api  - the Anthropic API with ANTHROPIC_API_KEY. Metered, structured
 *          output guaranteed by output_config.format. The reliable option.
 *   cli  - shell out to the locally installed `claude` CLI, billed to the
 *          user's Claude subscription rather than API credits. No structured
 *          output contract, so JSON is extracted from text and validated;
 *          slower, and subject to subscription usage limits.
 */
export type ClaudeProvider = "mock" | "api" | "cli";

const rawSource = str("JOB_SOURCE", "mock") as JobSourceName;

export const config = {
  dataDir: path.join(process.cwd(), "data"),
  resumeDir: path.join(process.cwd(), "data", "resumes"),
  tailoredDir: path.join(process.cwd(), "data", "tailored"),
  dbPath: path.join(process.cwd(), "data", "jobhunter.db"),

  anthropicApiKey: str("ANTHROPIC_API_KEY"),
  claudeCliPath: str("CLAUDE_CLI_PATH", "claude"),
  claudeMonthlyUsdCap: num("CLAUDE_MONTHLY_USD_CAP", 5),
  scoringModel: str("CLAUDE_SCORING_MODEL", "claude-haiku-5-5"),
  tailorModel: str("CLAUDE_TAILOR_MODEL", "claude-opus-5-5"),

  jobSource: (["mock", "jsearch-rapidapi", "jsearch-direct"] as const).includes(
    rawSource,
  )
    ? rawSource
    : ("mock" as JobSourceName),
  rapidApiKey: str("RAPIDAPI_KEY"),
  rapidApiHost: str("RAPIDAPI_HOST", "jsearch.p.rapidapi.com"),
  openWebNinjaApiKey: str("OPENWEBNINJA_API_KEY"),
  jsearchMonthlyQuota: num("JSEARCH_MONTHLY_QUOTA", 200),
  jsearchOverageUsd: num("JSEARCH_OVERAGE_USD", 0.003),

  maxJobAgeDays: num("MAX_JOB_AGE_DAYS", 14),
  scoreTopN: num("SCORE_TOP_N", 25),
} as const;

/**
 * USD per 1,000,000 tokens, verified against the Claude API pricing table.
 * Haiku 5.5 input/output rises to 0.50/2.50 for prompts over 100K tokens;
 * nothing this app sends comes close, so the base rate is what we meter.
 */
export const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4.0, output: 20.0 },
  "claude-opus-5": { input: 5.0, output: 25.0 },
  "claude-sonnet-5-5": { input: 2.0, output: 10.0 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

/** Cost of one call in USD. Unknown models are metered at Opus rates so an
 *  unrecognised model can never silently look free. */
export function costUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = PRICING[model] ?? PRICING["claude-opus-5-5"];
  return (
    (inputTokens / 1_000_000) * rate.input +
    (outputTokens / 1_000_000) * rate.output
  );
}

/**
 * Which Claude backend to use. An explicit CLAUDE_PROVIDER wins; otherwise we
 * infer: a key means the API, no key means mock. We never silently fall back
 * to the CLI, because that spends the user's subscription allowance.
 */
export function claudeProvider(): ClaudeProvider {
  const explicit = str("CLAUDE_PROVIDER").toLowerCase();
  if (explicit === "mock" || explicit === "api" || explicit === "cli") {
    return explicit;
  }
  return config.anthropicApiKey ? "api" : "mock";
}

/** True when Claude calls cost nothing. */
export function isMockClaude(): boolean {
  return claudeProvider() === "mock";
}

/** True when job search would be served from fixtures rather than billed. */
export function isMockJobs(): boolean {
  if (config.jobSource === "mock") return true;
  if (config.jobSource === "jsearch-rapidapi") return !config.rapidApiKey;
  if (config.jobSource === "jsearch-direct") return !config.openWebNinjaApiKey;
  return true;
}

export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}
