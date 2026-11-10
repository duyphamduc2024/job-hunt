"use client";

import { diffWords } from "diff";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { refreshUsage } from "@/components/Nav";
import {
  Banner,
  Spinner,
  StatusPill,
  daysAgo,
  formatSalary,
} from "@/components/ui";
import type {
  Application,
  ApplicationStatus,
  Job,
  Match,
  Tailoring,
} from "@/lib/types";

interface DiffSegment {
  value: string;
  added?: boolean;
  removed?: boolean;
}

interface TailorResponse {
  tailoring: Tailoring;
  diffs: { paragraphIndex: number; segments: DiffSegment[]; why: string }[];
  rejected: {
    change: { paragraphIndex: number; before: string; after: string };
    problems: string[];
  }[];
  warnings: string[];
  provider: string;
  usd: number;
  downloadUrl: string;
}

interface PrefillField {
  aliases: string[];
  label: string;
  value: string;
  confidence: "certain" | "derived";
}

interface ApplyPacket {
  job: { title: string; company: string; applyUrl: string; applyIsDirect: boolean };
  prefill: PrefillField[];
  resumeToAttach: { label: string; downloadUrl: string | null } | null;
  neverFill: string[];
  rules: string[];
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{
    job: Job;
    match: Match | null;
    application: Application;
    tailoring: Tailoring | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tailoring, setTailoring] = useState<TailorResponse | null>(null);
  const [tailorBusy, setTailorBusy] = useState(false);

  const [packet, setPacket] = useState<ApplyPacket | null>(null);
  const [packetBusy, setPacketBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/jobs/${id}`);
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Could not load that job.");
        return;
      }
      setData(d);
      // A job tailored in an earlier visit should not look untouched. Rebuild
      // the view from the stored changes, without re-running (or re-paying for)
      // anything. A fresh run later overwrites this with the richer result.
      if (d.tailoring) {
        setTailoring((current) =>
          current
            ? current
            : {
                tailoring: d.tailoring,
                diffs: (d.tailoring.changes ?? []).map(
                  (c: { paragraphIndex: number; before: string; after: string; why: string }) => ({
                    paragraphIndex: c.paragraphIndex,
                    segments: diffWords(c.before, c.after).map((part) => ({
                      value: part.value,
                      ...(part.added ? { added: true } : {}),
                      ...(part.removed ? { removed: true } : {}),
                    })),
                    why: c.why,
                  }),
                ),
                rejected: [],
                warnings: [],
                provider: "saved earlier",
                usd: 0,
                downloadUrl: `/api/tailor/${d.tailoring.id}/download`,
              },
        );
      }
    } catch (err) {
      setError(`Could not load: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runTailor() {
    setTailorBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: id }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Tailoring failed.");
        return;
      }
      setTailoring(d);
      refreshUsage();
      await load();
    } catch (err) {
      setError(`Tailoring failed: ${(err as Error).message}`);
    } finally {
      setTailorBusy(false);
    }
  }

  async function loadPacket() {
    setPacketBusy(true);
    try {
      const res = await fetch(`/api/apply/${id}`);
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Could not build the apply packet.");
        return;
      }
      setPacket(d);
    } catch (err) {
      setError(`Could not build the apply packet: ${(err as Error).message}`);
    } finally {
      setPacketBusy(false);
    }
  }

  async function setStatus(status: ApplicationStatus) {
    const res = await fetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) await load();
    else setError("Could not save that status change.");
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("The browser would not give access to the clipboard.");
    }
  }

  if (loading) return <Spinner label="Loading..." />;
  if (!data) {
    return (
      <>
        {error && <Banner kind="error">{error}</Banner>}
        <Link href="/jobs" className="btn">
          Back to jobs
        </Link>
      </>
    );
  }

  const { job, match, application } = data;
  const salary = formatSalary(
    job.salaryMin,
    job.salaryMax,
    job.salaryPeriod,
    job.salaryCurrency,
  );

  return (
    <div className="space-y-5">
      <Link href="/jobs" className="text-sm text-muted hover:underline">
        &larr; All jobs
      </Link>

      {error && (
        <Banner kind="error" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{job.title}</h1>
        <p className="text-muted">
          {job.company}
          {job.location ? ` — ${job.location}` : ""}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <span className="chip">{daysAgo(job.postedAt)}</span>
          {job.workMode && <span className="chip">{job.workMode}</span>}
          {job.jobType && <span className="chip">{job.jobType}</span>}
          {salary && <span className="chip">{salary}</span>}
          {job.applyIsDirect && (
            <span className="chip" style={{ color: "var(--good)" }}>
              applies direct to employer
            </span>
          )}
          {(job.alsoSeenOn?.length ?? 0) > 0 && (
            <span className="chip">via {job.alsoSeenOn!.join(", ")}</span>
          )}
          <StatusPill status={application.status} />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <a
          className="btn"
          href={job.applyUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open posting
        </a>
        <button
          className="btn btn-primary"
          onClick={() => void runTailor()}
          disabled={tailorBusy}
        >
          {tailorBusy ? "Tailoring..." : "Tailor my resume for this"}
        </button>
        <button
          className="btn"
          onClick={() => void loadPacket()}
          disabled={packetBusy}
        >
          {packetBusy ? "Building..." : "Help me apply"}
        </button>
        <select
          className="input text-sm"
          style={{ maxWidth: "10rem" }}
          value={application.status}
          onChange={(e) => void setStatus(e.target.value as ApplicationStatus)}
        >
          {[
            "new",
            "saved",
            "tailored",
            "applied",
            "interviewing",
            "rejected",
            "dismissed",
          ].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {match && (
        <section className="card p-4">
          <h2 className="mb-2 font-semibold">
            Match: {match.score}/100{" "}
            <span className="text-xs font-normal text-muted">
              ({match.scoredBy === "claude" ? "scored by Claude" : "keyword overlap only"})
            </span>
          </h2>
          {match.reasons.length > 0 && (
            <>
              <h3 className="mt-2 text-xs font-semibold uppercase text-muted">
                Why it matched
              </h3>
              <ul className="mt-1 space-y-0.5 text-sm">
                {match.reasons.map((r, i) => (
                  <li key={i} style={{ color: "var(--good)" }}>
                    + {r}
                  </li>
                ))}
              </ul>
            </>
          )}
          {match.gaps.length > 0 && (
            <>
              <h3 className="mt-3 text-xs font-semibold uppercase text-muted">
                Gaps
              </h3>
              <ul className="mt-1 space-y-0.5 text-sm">
                {match.gaps.map((g, i) => (
                  <li key={i} style={{ color: "var(--warn)" }}>
                    - {g}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {tailoring && (
        <section className="card space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Tailored resume</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">
                {tailoring.provider === "mock"
                  ? "mock mode"
                  : tailoring.usd === 0
                    ? tailoring.provider
                    : `${tailoring.provider}, $${tailoring.usd.toFixed(4)}`}
              </span>
              <a className="btn btn-primary" href={tailoring.downloadUrl}>
                Download .docx
              </a>
            </div>
          </div>

          <p className="text-sm">{tailoring.tailoring.summary}</p>

          {tailoring.warnings.map((w, i) => (
            <Banner key={i} kind="warn">
              {w}
            </Banner>
          ))}

          {tailoring.diffs.length === 0 ? (
            <p className="text-sm text-muted">
              No edits were applied. The downloaded file is a faithful copy of
              your original.
            </p>
          ) : (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase text-muted">
                {tailoring.diffs.length} change
                {tailoring.diffs.length === 1 ? "" : "s"}
              </h3>
              {tailoring.diffs.map((d) => (
                <div
                  key={d.paragraphIndex}
                  className="rounded-lg border border-border p-3"
                >
                  <p className="text-sm leading-relaxed">
                    {d.segments.map((s, i) => (
                      <span
                        key={i}
                        className={
                          s.added ? "diff-add" : s.removed ? "diff-del" : ""
                        }
                      >
                        {s.value}
                      </span>
                    ))}
                  </p>
                  <p className="mt-2 text-xs text-muted">{d.why}</p>
                </div>
              ))}
            </div>
          )}

          {tailoring.rejected.length > 0 && (
            <div
              className="rounded-lg border p-3"
              style={{
                borderColor: "var(--bad)",
                background: "color-mix(in srgb, var(--bad) 8%, transparent)",
              }}
            >
              <h3 className="text-sm font-semibold">
                Rejected edits ({tailoring.rejected.length}) - not written to
                your document
              </h3>
              <p className="mt-1 text-xs text-muted">
                These were blocked for inventing or dropping figures. Shown so
                you can see what was attempted.
              </p>
              <ul className="mt-2 space-y-2 text-xs">
                {tailoring.rejected.map((r, i) => (
                  <li key={i}>
                    <p className="line-through opacity-70">{r.change.after}</p>
                    <p style={{ color: "var(--bad)" }}>
                      {r.problems.join("; ")}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tailoring.tailoring.emphasised.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase text-muted">
                Brought forward
              </h3>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {tailoring.tailoring.emphasised.map((e, i) => (
                  <span key={i} className="chip">
                    {e}
                  </span>
                ))}
              </div>
            </div>
          )}

          {tailoring.tailoring.notAddressed.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase text-muted">
                What this resume cannot support
              </h3>
              <ul className="mt-1 space-y-0.5 text-sm">
                {tailoring.tailoring.notAddressed.map((n, i) => (
                  <li key={i} style={{ color: "var(--warn)" }}>
                    - {n}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted">
                Nothing was invented to cover these. Decide for yourself whether
                they are dealbreakers.
              </p>
            </div>
          )}
        </section>
      )}

      {packet && (
        <section className="card space-y-4 p-4">
          <h2 className="font-semibold">Applying</h2>

          <div
            className="rounded-lg border p-3 text-sm"
            style={{
              borderColor: "var(--accent)",
              background: "var(--accent-soft)",
            }}
          >
            <strong>You press submit, not the app.</strong>
            <ul className="mt-1 space-y-0.5 text-xs">
              {packet.rules.map((r, i) => (
                <li key={i}>- {r}</li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              className="btn btn-primary"
              href={packet.job.applyUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open the application form
            </a>
            <button
              className="btn"
              onClick={() =>
                void copy(buildChromePrompt(packet), "Claude for Chrome prompt")
              }
            >
              Copy prompt for Claude for Chrome
            </button>
            <button
              className="btn"
              onClick={() =>
                void copy(
                  JSON.stringify(
                    Object.fromEntries(
                      packet.prefill.map((f) => [f.label, f.value]),
                    ),
                    null,
                    2,
                  ),
                  "all fields as JSON",
                )
              }
            >
              Copy all fields
            </button>
            {packet.resumeToAttach?.downloadUrl && (
              <a className="btn" href={packet.resumeToAttach.downloadUrl}>
                Download {packet.resumeToAttach.label.toLowerCase()}
              </a>
            )}
            {copied && (
              <span className="text-xs" style={{ color: "var(--good)" }}>
                Copied {copied}
              </span>
            )}
          </div>

          <p className="text-xs text-muted">
            With Claude for Chrome: open the form, then paste the copied prompt
            into the extension. It fills what it can and stops. If the form is a
            Workday or Taleo multi-step wizard, expect to help it along - every
            ATS lays its fields out differently.
          </p>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted">
              Fields to fill ({packet.prefill.length})
            </h3>
            <ul className="divide-y divide-border text-sm">
              {packet.prefill.map((f) => (
                <li
                  key={f.label}
                  className="flex items-center justify-between gap-3 py-1.5"
                >
                  <span className="text-muted">
                    {f.label}
                    {f.confidence === "derived" && (
                      <span
                        className="ml-1 text-xs"
                        title="Worked out rather than read directly - check it"
                        style={{ color: "var(--warn)" }}
                      >
                        (derived)
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{f.value}</span>
                    <button
                      className="chip"
                      onClick={() => void copy(f.value, f.label)}
                    >
                      copy
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase" style={{ color: "var(--bad)" }}>
              Never filled automatically
            </h3>
            <ul className="space-y-0.5 text-xs text-muted">
              {packet.neverFill.map((n, i) => (
                <li key={i}>- {n}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Full posting</h2>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {job.description || "No description was provided by the source."}
        </p>
      </section>
    </div>
  );
}

/** A ready-to-paste instruction for the browser extension. The no-submit rule
 *  is stated in the prompt itself, not just in our UI. */
function buildChromePrompt(packet: ApplyPacket): string {
  const fields = packet.prefill
    .map((f) => `- ${f.label}: ${f.value}`)
    .join("\n");
  return [
    `I am applying for "${packet.job.title}" at ${packet.job.company} on the page that is open.`,
    "",
    "Please fill in the application form using exactly these values:",
    fields,
    "",
    "Rules:",
    "- Do NOT click submit, apply, or any final confirmation button. Stop when the fields are filled and tell me what is left.",
    "- Do NOT create an account or enter any password.",
    "- Leave these blank for me to handle myself:",
    ...packet.neverFill.map((n) => `  - ${n}`),
    "- If a required field has no value above, leave it empty and list it for me rather than guessing.",
    "- If a question needs a written answer, draft it but tell me before putting it in.",
    "",
    packet.resumeToAttach
      ? `I will attach my resume (${packet.resumeToAttach.label}) myself.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
