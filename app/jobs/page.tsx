"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { refreshUsage } from "@/components/Nav";
import {
  Banner,
  Spinner,
  StatusPill,
  daysAgo,
  formatSalary,
} from "@/components/ui";
import type { Application, ApplicationStatus, Job, Match } from "@/lib/types";

interface Item {
  job: Job;
  match: Match | null;
  application: Application;
}

interface SearchStats {
  fetched: number;
  droppedTooOld: number;
  droppedUndated: number;
  collapsedDuplicates: number;
  excludedByPreference: number;
  requestsUsed: number;
  newJobs: number;
  refreshedJobs: number;
  jobsScored: number;
  reusedScores: number;
  claudeUsd: number;
  scoringProvider: string;
}

const FILTERS: { key: string; label: string; statuses?: ApplicationStatus[] }[] =
  [
    { key: "open", label: "Open", statuses: ["new", "saved", "tailored"] },
    { key: "all", label: "Everything" },
    { key: "applied", label: "Applied", statuses: ["applied", "interviewing"] },
    { key: "closed", label: "Closed", statuses: ["rejected", "dismissed"] },
  ];

export default function JobsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [stats, setStats] = useState<SearchStats | null>(null);
  const [queries, setQueries] = useState<string[]>([]);
  const [filter, setFilter] = useState("open");
  const [maxAge, setMaxAge] = useState(14);

  const load = useCallback(async (key: string) => {
    setLoading(true);
    try {
      const f = FILTERS.find((x) => x.key === key);
      const params = new URLSearchParams();
      for (const s of f?.statuses ?? []) params.append("status", s);
      if (key === "all") params.set("scope", "all");
      const res = await fetch(`/api/jobs?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not load jobs.");
        return;
      }
      setItems(data.items);
      setMaxAge(data.maxJobAgeDays);
    } catch (err) {
      setError(`Could not load jobs: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  async function runSearch() {
    setSearching(true);
    setError(null);
    setWarnings([]);
    setStats(null);
    try {
      const res = await fetch("/api/search", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Search failed.");
        return;
      }
      setStats(data.stats);
      setWarnings(data.warnings ?? []);
      setQueries(data.queries ?? []);
      refreshUsage();
      await load(filter);
    } catch (err) {
      setError(`Search failed: ${(err as Error).message}`);
    } finally {
      setSearching(false);
    }
  }

  async function setStatus(jobId: string, status: ApplicationStatus) {
    // Optimistic: the list is long and a round-trip per click feels broken.
    setItems((prev) =>
      prev.map((it) =>
        it.job.id === jobId
          ? { ...it, application: { ...it.application, status } }
          : it,
      ),
    );
    const res = await fetch(`/api/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      setError("Could not save that status change.");
      await load(filter);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
          <p className="mt-1 text-sm text-muted">
            Only postings newer than {maxAge} days. A posting with no date is
            discarded rather than shown with a guess.
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => void runSearch()}
          disabled={searching}
        >
          {searching ? "Searching..." : "Run search"}
        </button>
      </header>

      {error && <Banner kind="error" onDismiss={() => setError(null)}>{error}</Banner>}
      {warnings.map((w, i) => (
        <Banner key={i} kind="warn">
          {w}
        </Banner>
      ))}

      {searching && (
        <div className="card p-4">
          <Spinner label="Querying the job source, filtering by date, then scoring the best matches..." />
        </div>
      )}

      {stats && (
        <div className="card p-4 text-sm">
          <h2 className="mb-2 font-semibold">What that search did</h2>
          {queries.length > 0 && (
            <p className="mb-2 text-xs text-muted">
              Queries: {queries.map((q) => `"${q}"`).join(", ")}
            </p>
          )}
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <Stat label="Postings returned" value={stats.fetched} />
            <Stat
              label={`Dropped: older than ${maxAge} days`}
              value={stats.droppedTooOld}
            />
            <Stat label="Dropped: no posting date" value={stats.droppedUndated} />
            <Stat
              label="Duplicates merged across boards"
              value={stats.collapsedDuplicates}
            />
            <Stat
              label="Excluded by your preferences"
              value={stats.excludedByPreference}
            />
            <Stat label="New to you" value={stats.newJobs} />
            <Stat label="Already seen, refreshed" value={stats.refreshedJobs} />
            <Stat label="Scored by Claude" value={stats.jobsScored} />
            <Stat
              label="Scores reused (not paid for again)"
              value={stats.reusedScores}
            />
            <Stat label="API requests used" value={stats.requestsUsed} />
            <Stat
              label="Claude cost"
              value={`$${stats.claudeUsd.toFixed(4)} (${stats.scoringProvider})`}
            />
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className="chip"
            style={
              filter === f.key
                ? {
                    borderColor: "var(--accent)",
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                  }
                : undefined
            }
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner label="Loading..." />
      ) : items.length === 0 ? (
        <div className="card p-6 text-center text-sm text-muted">
          Nothing here yet. Press <strong>Run search</strong> above.
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map(({ job, match, application }) => (
            <li key={job.id} className="card p-4">
              <div className="flex flex-wrap items-start gap-3">
                <ScoreBadge match={match} />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/jobs/${job.id}`}
                    className="font-semibold hover:underline"
                  >
                    {job.title}
                  </Link>
                  <p className="text-sm text-muted">
                    {job.company}
                    {job.location ? ` — ${job.location}` : ""}
                  </p>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="chip">{daysAgo(job.postedAt)}</span>
                    {job.workMode && <span className="chip">{job.workMode}</span>}
                    {formatSalary(
                      job.salaryMin,
                      job.salaryMax,
                      job.salaryPeriod,
                      job.salaryCurrency,
                    ) && (
                      <span className="chip">
                        {formatSalary(
                          job.salaryMin,
                          job.salaryMax,
                          job.salaryPeriod,
                          job.salaryCurrency,
                        )}
                      </span>
                    )}
                    {job.applyIsDirect && (
                      <span className="chip" style={{ color: "var(--good)" }}>
                        applies direct
                      </span>
                    )}
                    {(job.alsoSeenOn?.length ?? 0) > 1 && (
                      <span className="chip">
                        on {job.alsoSeenOn!.length} boards
                      </span>
                    )}
                    <StatusPill status={application.status} />
                  </div>

                  {match && match.reasons.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-muted">
                      {match.reasons.map((r, i) => (
                        <li key={i}>+ {r}</li>
                      ))}
                      {match.gaps.map((g, i) => (
                        <li key={`g${i}`} style={{ color: "var(--warn)" }}>
                          - {g}
                        </li>
                      ))}
                    </ul>
                  )}
                  {match?.scoredBy === "prefilter" && (
                    <p className="mt-1 text-xs text-muted">
                      Keyword match only - not scored by Claude.
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-col gap-2">
                  <Link href={`/jobs/${job.id}`} className="btn">
                    Open
                  </Link>
                  <select
                    className="input text-xs"
                    value={application.status}
                    onChange={(e) =>
                      void setStatus(
                        job.id,
                        e.target.value as ApplicationStatus,
                      )
                    }
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
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <li className="flex justify-between gap-3 border-b border-border py-0.5">
      <span className="text-muted">{label}</span>
      <span className="font-mono font-semibold">{value}</span>
    </li>
  );
}

function ScoreBadge({ match }: { match: Match | null }) {
  if (!match) {
    return (
      <span className="chip shrink-0" style={{ color: "var(--muted)" }}>
        unscored
      </span>
    );
  }
  const color =
    match.score >= 80
      ? "var(--good)"
      : match.score >= 60
        ? "var(--accent)"
        : match.score >= 40
          ? "var(--warn)"
          : "var(--muted)";
  return (
    <div
      className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg border font-mono"
      style={{
        borderColor: color,
        color,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
      title={
        match.scoredBy === "claude"
          ? "Scored by Claude against your profile"
          : "Keyword overlap only"
      }
    >
      <span className="text-base font-bold leading-none">{match.score}</span>
      <span className="text-[9px] uppercase opacity-70">
        {match.scoredBy === "claude" ? "fit" : "kw"}
      </span>
    </div>
  );
}
