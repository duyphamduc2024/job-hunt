import { spawn } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type * as z from "zod/v4";
import { claudeProvider, config, costUsd } from "./config";
import { claudeSpendThisMonth, logUsage } from "./db";

// ---------------------------------------------------------------------------
// The single door to Claude. Every call is metered, every call is capped, and
// every call returns schema-validated data or throws. Three backends:
//
//   mock - returns the caller's fixture. Free, offline, deterministic.
//   api  - the Anthropic API. output_config.format guarantees valid JSON.
//   cli  - the local claude binary, billed to the user's subscription.
//          No structured-output contract, so we extract and validate.
// ---------------------------------------------------------------------------

export class SpendCapReached extends Error {
  constructor(spent: number, cap: number) {
    super(
      `Claude spend cap reached: $${spent.toFixed(4)} of $${cap.toFixed(
        2,
      )} this month. Raise CLAUDE_MONTHLY_USD_CAP in .env.local to continue.`,
    );
    this.name = "SpendCapReached";
  }
}

export class ClaudeUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeUnavailable";
  }
}

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return cachedClient;
}

export interface StructuredCall<T> {
  /** Which model to use. Caller picks, so scoring and tailoring differ. */
  model: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** Shown in the usage log so the user can see what they paid for. */
  detail: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  /** Returned verbatim when the provider is mock. Required, so that mock
   *  mode is never an afterthought that silently breaks. */
  mock: T;
}

export interface StructuredResult<T> {
  data: T;
  provider: "mock" | "api" | "cli";
  usd: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Ask Claude for a value matching the schema. Throws SpendCapReached before
 * spending anything if the month's cap is already met.
 */
export async function structured<T>(
  call: StructuredCall<T>,
): Promise<StructuredResult<T>> {
  const provider = claudeProvider();

  if (provider === "mock") {
    logUsage({
      kind: "claude",
      detail: `${call.detail} (mock)`,
      model: call.model,
      mocked: true,
    });
    return {
      data: call.schema.parse(call.mock),
      provider,
      usd: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  if (provider === "api") {
    const spent = claudeSpendThisMonth();
    if (spent >= config.claudeMonthlyUsdCap) {
      throw new SpendCapReached(spent, config.claudeMonthlyUsdCap);
    }
    return await viaApi(call);
  }

  return await viaCli(call);
}

async function viaApi<T>(call: StructuredCall<T>): Promise<StructuredResult<T>> {
  if (!config.anthropicApiKey) {
    throw new ClaudeUnavailable(
      "CLAUDE_PROVIDER=api but ANTHROPIC_API_KEY is not set in .env.local.",
    );
  }

  const response = await client().messages.parse({
    model: call.model,
    max_tokens: call.maxTokens ?? 16000,
    system: call.system,
    messages: [{ role: "user", content: call.user }],
    output_config: {
      format: zodOutputFormat(call.schema),
      effort: call.effort ?? "medium",
    },
  });

  if (response.stop_reason === "refusal") {
    throw new ClaudeUnavailable(
      `Claude declined this request (${
        response.stop_details?.category ?? "unspecified"
      }). Nothing was changed.`,
    );
  }
  if (response.stop_reason === "max_tokens") {
    throw new ClaudeUnavailable(
      "Claude's reply hit the token ceiling and was cut off. Retry; if it " +
        "keeps happening the resume or posting is too long for one call.",
    );
  }
  if (response.parsed_output == null) {
    throw new ClaudeUnavailable(
      "Claude's reply did not match the expected shape. Nothing was changed.",
    );
  }

  const inputTokens = response.usage.input_tokens ?? 0;
  const outputTokens = response.usage.output_tokens ?? 0;
  const usd = costUsd(call.model, inputTokens, outputTokens);

  logUsage({
    kind: "claude",
    detail: call.detail,
    model: call.model,
    inputTokens,
    outputTokens,
    usd,
    mocked: false,
  });

  return {
    data: response.parsed_output as T,
    provider: "api",
    usd,
    inputTokens,
    outputTokens,
  };
}

/**
 * Drive the locally installed claude binary. This spends the user's Claude
 * subscription allowance, not API credits, so there is no dollar figure to
 * meter - we record the call and its token counts where the CLI reports them.
 */
async function viaCli<T>(call: StructuredCall<T>): Promise<StructuredResult<T>> {
  const prompt = [
    call.system,
    "",
    "Reply with a single JSON object and nothing else: no prose before or",
    "after it, and no markdown code fences. It must match this JSON Schema:",
    JSON.stringify(zodJsonSchema(call.schema), null, 2),
    "",
    "---",
    "",
    call.user,
  ].join("\n");

  const { stdout, stderr, code } = await run(
    config.claudeCliPath,
    ["-p", "--output-format", "json", "--model", call.model],
    prompt,
  );

  if (code !== 0) {
    throw new ClaudeUnavailable(
      `The claude CLI exited with code ${code}. ` +
        (stderr.trim().slice(0, 400) ||
          "Check that it is installed and signed in."),
    );
  }

  // The CLI wraps the reply in a result envelope; older versions print raw text.
  let text = stdout;
  let usage: { input_tokens?: number; output_tokens?: number } | undefined;
  try {
    const envelope = JSON.parse(stdout) as {
      result?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
      is_error?: boolean;
    };
    if (envelope.is_error) {
      throw new ClaudeUnavailable(
        `The claude CLI reported an error: ${String(envelope.result ?? "").slice(
          0,
          400,
        )}`,
      );
    }
    if (typeof envelope.result === "string") text = envelope.result;
    usage = envelope.usage;
  } catch (err) {
    if (err instanceof ClaudeUnavailable) throw err;
    // Not an envelope - treat stdout as the reply itself.
  }

  const parsed = call.schema.safeParse(extractJson(text));
  if (!parsed.success) {
    throw new ClaudeUnavailable(
      "The claude CLI did not return JSON matching the expected shape. This " +
        "is the known weakness of CLAUDE_PROVIDER=cli - the api path " +
        "guarantees the shape. First problem: " +
        (parsed.error.issues[0]?.message ?? "unknown"),
    );
  }

  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  logUsage({
    kind: "claude",
    detail: `${call.detail} (cli/subscription)`,
    model: call.model,
    inputTokens,
    outputTokens,
    usd: 0, // billed to the subscription, not to API credits
    mocked: false,
  });

  return {
    data: parsed.data as T,
    provider: "cli",
    usd: 0,
    inputTokens,
    outputTokens,
  };
}

/** Pull the first complete JSON object out of a possibly chatty reply. */
export function extractJson(text: string): unknown {
  const fence = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  const cleaned = (fence ? fence[1] : text).trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall through to brace scanning.
  }
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** The JSON Schema the SDK helper would send, reused to brief the CLI. */
function zodJsonSchema(schema: z.ZodType): unknown {
  const format = zodOutputFormat(schema) as unknown as { schema?: unknown };
  return format.schema ?? {};
}

function run(
  cmd: string,
  args: string[],
  stdin: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) =>
      reject(
        new ClaudeUnavailable(
          `Could not run ${cmd}: ${err.message}. Set CLAUDE_CLI_PATH, or ` +
            "switch CLAUDE_PROVIDER to api or mock.",
        ),
      ),
    );
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
    child.stdin.write(stdin);
    child.stdin.end();
    // The CLI can take a while on a long resume; 5 minutes is generous.
    setTimeout(() => child.kill("SIGKILL"), 300_000).unref();
  });
}
