import Link from "next/link";
import { claudeProvider, config, isMockJobs } from "@/lib/config";
import { getProfile, statusCounts, usageSummary } from "@/lib/db";

export const dynamic = "force-dynamic";

const PIPELINE: { key: string; label: string }[] = [
  { key: "new", label: "New" },
  { key: "saved", label: "Saved" },
  { key: "tailored", label: "Tailored" },
  { key: "applied", label: "Applied" },
  { key: "interviewing", label: "Interviewing" },
  { key: "rejected", label: "Rejected" },
];

export default function Home() {
  const profile = getProfile();
  const usage = usageSummary();
  const counts = statusCounts();
  const claude = claudeProvider();
  const jobsMocked = isMockJobs();

  const steps = [
    {
      done: Boolean(profile?.resumePath),
      label: "Upload your resume (.docx)",
      href: "/upload",
      cta: "Upload",
    },
    {
      done: Boolean(profile?.preferences.targetTitles.length),
      label: "Say what you are looking for",
      href: "/preferences",
      cta: "Fill in",
    },
    {
      done: Boolean(profile?.confirmedAt),
      label: "Check the profile read off your resume",
      href: "/review",
      cta: "Review",
    },
  ];
  const nextStep = steps.find((s) => !s.done);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {profile?.resume.fullName
            ? `Hello, ${profile.resume.fullName.split(" ")[0]}`
            : "JobHunter"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          Running locally. Your resume, profile and saved jobs stay in{" "}
          <code>data/</code> on this machine.
        </p>
      </header>

      {(claude === "mock" || jobsMocked) && (
        <div
          className="rounded-lg border p-3 text-sm"
          style={{
            borderColor: "var(--warn)",
            background: "color-mix(in srgb, var(--warn) 10%, transparent)",
          }}
        >
          <strong>Nothing is costing you money yet.</strong>{" "}
          {claude === "mock" && "Claude is in mock mode. "}
          {jobsMocked && "Job search is returning sample postings. "}
          Everything works end to end, but the output is not real. See{" "}
          <code>.env.example</code> for how to switch each one on.
        </div>
      )}

      <section className="card p-4">
        <h2 className="mb-3 font-semibold">Setup</h2>
        <ol className="space-y-2 text-sm">
          {steps.map((s) => (
            <li key={s.href} className="flex items-center gap-3">
              <span
                aria-hidden
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs"
                style={
                  s.done
                    ? {
                        borderColor: "var(--good)",
                        color: "var(--good)",
                        background:
                          "color-mix(in srgb, var(--good) 12%, transparent)",
                      }
                    : { borderColor: "var(--border)", color: "var(--muted)" }
                }
              >
                {s.done ? "✓" : ""}
              </span>
              <span className={s.done ? "text-muted line-through" : ""}>
                {s.label}
              </span>
              {!s.done && (
                <Link href={s.href} className="btn ml-auto">
                  {s.cta}
                </Link>
              )}
            </li>
          ))}
        </ol>
        {!nextStep && (
          <div className="mt-4 flex items-center gap-3">
            <Link href="/jobs" className="btn btn-primary">
              Find matching jobs
            </Link>
            <span className="text-xs text-muted">
              Postings newer than {config.maxJobAgeDays} days only.
            </span>
          </div>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="card p-4">
          <h2 className="mb-3 font-semibold">Pipeline</h2>
          {Object.keys(counts).length === 0 ? (
            <p className="text-sm text-muted">
              No jobs yet. Run a search once your profile is confirmed.
            </p>
          ) : (
            <dl className="space-y-1.5 text-sm">
              {PIPELINE.filter((p) => counts[p.key]).map((p) => (
                <div key={p.key} className="flex justify-between">
                  <dt className="text-muted">{p.label}</dt>
                  <dd className="font-mono font-semibold">{counts[p.key]}</dd>
                </div>
              ))}
            </dl>
          )}
          <Link href="/jobs" className="btn mt-4">
            Open job list
          </Link>
        </div>

        <div className="card p-4">
          <h2 className="mb-3 font-semibold">This month</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Job API requests</dt>
              <dd className="font-mono">
                {usage.jsearch.requests.toLocaleString()} /{" "}
                {usage.jsearch.quota.toLocaleString()}
              </dd>
            </div>
            {usage.jsearch.overageRequests > 0 && (
              <div className="flex items-baseline justify-between gap-3">
                <dt style={{ color: "var(--warn)" }}>Over your allowance</dt>
                <dd className="font-mono" style={{ color: "var(--warn)" }}>
                  {usage.jsearch.overageRequests} = $
                  {usage.jsearch.overageUsd.toFixed(2)}
                </dd>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Claude spend</dt>
              <dd className="font-mono">
                ${usage.claude.usd.toFixed(4)} / $
                {usage.claude.cap.toFixed(2)} cap
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Claude calls</dt>
              <dd className="font-mono">{usage.claude.callCount}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">
            Scoring: <code>{config.scoringModel}</code>
            <br />
            Tailoring: <code>{config.tailorModel}</code>
            <br />
            Claude backend: <code>{claude}</code>, jobs:{" "}
            <code>{config.jobSource}</code>
          </p>
          {usage.claude.capReached && (
            <p className="mt-2 text-xs" style={{ color: "var(--bad)" }}>
              The spend cap is reached. Paid Claude calls are refused until you
              raise <code>CLAUDE_MONTHLY_USD_CAP</code>.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
