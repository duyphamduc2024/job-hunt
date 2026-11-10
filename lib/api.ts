import { ClaudeUnavailable, SpendCapReached } from "./claude";

// ---------------------------------------------------------------------------
// Shared response helpers. Errors the user can act on get a clear message and
// a sensible status; everything else is logged server-side and reported
// without leaking internals.
// ---------------------------------------------------------------------------

export function ok<T>(data: T, status = 200): Response {
  return Response.json(data as object, { status });
}

export function bad(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export function failed(err: unknown, context: string): Response {
  if (err instanceof SpendCapReached) {
    // 402: the request was understood but costs money the user capped.
    return Response.json({ error: err.message, kind: "spend_cap" }, { status: 402 });
  }
  if (err instanceof ClaudeUnavailable) {
    return Response.json(
      { error: err.message, kind: "claude_unavailable" },
      { status: 503 },
    );
  }
  if (err instanceof Error) {
    console.error(`[${context}]`, err);
    return Response.json({ error: err.message }, { status: 500 });
  }
  console.error(`[${context}] non-error thrown:`, err);
  return Response.json(
    { error: "Something went wrong. Check the server log." },
    { status: 500 },
  );
}
