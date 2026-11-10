/**
 * Verify the keys in .env.local actually work, before you trust the app with
 * them.
 *
 *   npm run check-keys            free: validates the Anthropic key without
 *                                 spending, and uses 1 JSearch request
 *   npm run check-keys -- --spend also makes one tiny real Claude call
 *                                 (~$0.00002) to prove you have CREDIT, not
 *                                 just a valid key
 *   npm run check-keys -- --no-jobs   skip the JSearch call entirely
 */
import { loadEnvConfig } from "@next/env";

// Must happen before anything reads process.env.
loadEnvConfig(process.cwd());

const SPEND = process.argv.includes("--spend");
const SKIP_JOBS = process.argv.includes("--no-jobs");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const OFF = "\x1b[0m";

const ok = (m: string) => console.log(`${GREEN}  OK${OFF}    ${m}`);
const bad = (m: string) => console.log(`${RED}  FAIL${OFF}  ${m}`);
const warn = (m: string) => console.log(`${YELLOW}  NOTE${OFF}  ${m}`);
const dim = (m: string) => console.log(`${DIM}        ${m}${OFF}`);

let failures = 0;

/** Never print a key. Show only enough to tell two keys apart. */
function fingerprint(key: string): string {
  if (key.length < 12) return "(suspiciously short)";
  return `${key.slice(0, 7)}...${key.slice(-4)} (${key.length} chars)`;
}

async function checkClaude() {
  console.log("\nClaude");
  const provider = (process.env.CLAUDE_PROVIDER ?? "").trim().toLowerCase();
  const key = (process.env.ANTHROPIC_API_KEY ?? "").trim();

  if (provider === "mock" || (!provider && !key)) {
    warn("CLAUDE_PROVIDER=mock - no key needed, and nothing will be billed.");
    dim("Set CLAUDE_PROVIDER=api and ANTHROPIC_API_KEY to use the real thing.");
    return;
  }

  if (provider === "cli") {
    warn("CLAUDE_PROVIDER=cli - calls bill your Claude subscription, not an API key.");
    const { spawnSync } = await import("node:child_process");
    const bin = (process.env.CLAUDE_CLI_PATH ?? "claude").trim();
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if (r.error || r.status !== 0) {
      bad(`Could not run "${bin} --version". Is the CLI installed and on PATH?`);
      failures++;
      return;
    }
    ok(`${bin} is installed: ${r.stdout.trim()}`);
    dim("Note: the cli provider has no structured-output guarantee. See the README.");
    return;
  }

  if (!key) {
    bad("CLAUDE_PROVIDER=api but ANTHROPIC_API_KEY is empty in .env.local.");
    failures++;
    return;
  }
  if (!key.startsWith("sk-ant-")) {
    warn(`Key does not start with "sk-ant-" - check you pasted an API key and not something else.`);
  }
  dim(`key ${fingerprint(key)}`);

  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: key, maxRetries: 1 });
  const model = (process.env.CLAUDE_SCORING_MODEL ?? "claude-haiku-5-5").trim();

  // Token counting is free, so this proves the key is valid and the model name
  // is accepted without spending anything.
  try {
    const counted = await client.messages.countTokens({
      model,
      messages: [{ role: "user", content: "ping" }],
    });
    ok(`key accepted; model "${model}" is reachable (${counted.input_tokens} tokens counted, $0.00)`);
  } catch (err) {
    failures++;
    const e = err as { status?: number; message?: string; name?: string };
    if (e.status === 401) bad("Key rejected (401). It is wrong, revoked, or from another org.");
    else if (e.status === 403) bad("Key lacks permission (403). Check its scopes in the Console.");
    else if (e.status === 404) bad(`Model "${model}" not found (404). Check CLAUDE_SCORING_MODEL.`);
    else if (e.status === 429) bad("Rate limited (429) - the key works, but you are being throttled.");
    else bad(`Could not reach the API: ${e.message ?? String(err)}`);
    return;
  }

  // A valid key is not the same as a funded account. Only a real call shows that.
  if (!SPEND) {
    warn("This did NOT check you have credit - token counting is free even at a $0 balance.");
    dim("Run: npm run check-keys -- --spend   for a ~$0.00002 call that proves billing works.");
    return;
  }

  try {
    const res = await client.messages.create({
      model,
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });
    const cost =
      (res.usage.input_tokens / 1e6) * 0.1 + (res.usage.output_tokens / 1e6) * 0.5;
    ok(
      `billing works: ${res.usage.input_tokens} in / ${res.usage.output_tokens} out, ` +
        `about $${cost.toFixed(6)}`,
    );
  } catch (err) {
    failures++;
    const e = err as { status?: number; message?: string };
    if (e.status === 400 && /credit|balance/i.test(e.message ?? "")) {
      bad("The key is valid but the account has no credit. Top up in the Console.");
    } else {
      bad(`Real call failed: ${e.message ?? String(err)}`);
    }
  }
}

async function checkJobs() {
  console.log("\nJob search");
  const source = (process.env.JOB_SOURCE ?? "mock").trim();

  if (source === "mock") {
    warn("JOB_SOURCE=mock - sample postings, no key needed, nothing billed.");
    dim("Set JOB_SOURCE=jsearch-rapidapi and RAPIDAPI_KEY for real postings.");
    return;
  }

  let url: string;
  let headers: Record<string, string>;

  if (source === "jsearch-rapidapi") {
    const key = (process.env.RAPIDAPI_KEY ?? "").trim();
    const host = (process.env.RAPIDAPI_HOST ?? "jsearch.p.rapidapi.com").trim();
    if (!key) {
      bad("JOB_SOURCE=jsearch-rapidapi but RAPIDAPI_KEY is empty in .env.local.");
      failures++;
      return;
    }
    dim(`key ${fingerprint(key)} -> ${host}`);
    url = `https://${host}/search`;
    headers = { "x-rapidapi-key": key, "x-rapidapi-host": host, Accept: "application/json" };
  } else if (source === "jsearch-direct") {
    const key = (process.env.OPENWEBNINJA_API_KEY ?? "").trim();
    const base = (process.env.JSEARCH_DIRECT_BASE_URL ?? "").trim().replace(/\/+$/, "");
    if (!key || !base) {
      bad("jsearch-direct needs both OPENWEBNINJA_API_KEY and JSEARCH_DIRECT_BASE_URL.");
      failures++;
      return;
    }
    dim(`key ${fingerprint(key)} -> ${base}`);
    url = `${base}/search`;
    headers = { "x-api-key": key, Accept: "application/json" };
  } else {
    bad(`JOB_SOURCE="${source}" is not a value this app understands.`);
    failures++;
    return;
  }

  if (SKIP_JOBS) {
    warn("Skipping the live job-API call because --no-jobs was passed.");
    return;
  }

  warn("This uses exactly 1 request from your monthly allowance.");
  const params = new URLSearchParams({
    query: "data analyst in austin",
    page: "1",
    num_pages: "1",
    date_posted: "week",
    country: "us",
  });

  let res: Response;
  try {
    res = await fetch(`${url}?${params}`, { headers, signal: AbortSignal.timeout(45_000) });
  } catch (err) {
    bad(`Could not reach the job API: ${(err as Error).message}`);
    failures++;
    return;
  }

  const limit = res.headers.get("x-ratelimit-requests-limit");
  const left = res.headers.get("x-ratelimit-requests-remaining");

  if (res.status === 401 || res.status === 403) {
    bad(`Key rejected (${res.status}). Check the key, and that you are subscribed to JSearch.`);
    failures++;
    return;
  }
  if (res.status === 429) {
    bad("Rate limited (429) - the monthly allowance may already be used up.");
    failures++;
    return;
  }
  if (!res.ok) {
    bad(`Job API returned HTTP ${res.status}.`);
    failures++;
    return;
  }

  const body = (await res.json()) as { data?: unknown[] };
  const count = body.data?.length ?? 0;
  ok(`key accepted; ${count} postings returned for a test query`);
  if (limit && left) {
    const used = Number(limit) - Number(left);
    ok(`plan allowance: ${used} used of ${limit}, ${left} left this month`);
    const configured = process.env.JSEARCH_MONTHLY_QUOTA;
    if (configured && Number(configured) !== Number(limit)) {
      warn(
        `JSEARCH_MONTHLY_QUOTA is ${configured} but your plan reports ${limit}. ` +
          "Update .env.local so the meter in the app is honest.",
      );
    }
  } else {
    dim("The API did not send quota headers, so the app counts requests itself.");
  }
}

async function main() {
  console.log("Checking the keys in .env.local");
  console.log(`${DIM}        Keys are never printed in full.${OFF}`);
  await checkClaude();
  await checkJobs();

  console.log("");
  if (failures === 0) {
    console.log(`${GREEN}Everything checked out.${OFF}`);
  } else {
    console.log(`${RED}${failures} problem(s) above.${OFF}`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
