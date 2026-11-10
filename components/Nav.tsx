"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { UsageSummary } from "@/lib/types";

interface UsagePayload {
  usage: UsageSummary;
  providers: {
    claude: string;
    jobs: string;
    jobsAreMocked: boolean;
    scoringModel: string;
    tailorModel: string;
  };
}

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/upload", label: "Resume" },
  { href: "/preferences", label: "Preferences" },
  { href: "/review", label: "Profile" },
  { href: "/jobs", label: "Jobs" },
];

/** Refreshed on navigation and after any action that spends something. */
export function Nav() {
  const pathname = usePathname();
  const [data, setData] = useState<UsagePayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setData(d))
      .catch(() => {});
    const onRefresh = () => {
      fetch("/api/usage")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => !cancelled && setData(d))
        .catch(() => {});
    };
    window.addEventListener("jobhunter:usage", onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener("jobhunter:usage", onRefresh);
    };
  }, [pathname]);

  const u = data?.usage;
  const p = data?.providers;
  const claudePct = u ? Math.min(100, (u.claude.usd / u.claude.cap) * 100) : 0;
  const reqPct = u
    ? Math.min(100, (u.jsearch.requests / Math.max(1, u.jsearch.quota)) * 100)
    : 0;

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
        <Link href="/" className="font-semibold tracking-tight">
          JobHunter
        </Link>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {LINKS.map((l) => {
            const active =
              l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className="transition-colors"
                style={{
                  color: active ? "var(--accent)" : "var(--muted)",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-4 text-xs">
          {u && p && (
            <>
              <div title="Job API requests used this month">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted">Requests</span>
                  <span className="font-mono font-semibold">
                    {u.jsearch.requests.toLocaleString()}/
                    {u.jsearch.quota.toLocaleString()}
                  </span>
                  {u.jsearch.overageRequests > 0 && (
                    <span style={{ color: "var(--warn)" }}>
                      +{u.jsearch.overageRequests} over = $
                      {u.jsearch.overageUsd.toFixed(2)}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 h-1 w-28 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${reqPct}%`,
                      background:
                        u.jsearch.overageRequests > 0
                          ? "var(--warn)"
                          : "var(--accent)",
                    }}
                  />
                </div>
              </div>

              <div title="Claude API spend this month against your cap">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted">Claude</span>
                  <span className="font-mono font-semibold">
                    ${u.claude.usd.toFixed(3)}/${u.claude.cap.toFixed(2)}
                  </span>
                  {u.claude.capReached && (
                    <span style={{ color: "var(--bad)" }}>cap reached</span>
                  )}
                </div>
                <div className="mt-0.5 h-1 w-28 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${claudePct}%`,
                      background: u.claude.capReached
                        ? "var(--bad)"
                        : "var(--good)",
                    }}
                  />
                </div>
              </div>

              <div className="flex gap-1">
                {p.claude === "mock" && (
                  <span className="chip" style={{ color: "var(--warn)" }}>
                    Claude: mock
                  </span>
                )}
                {p.claude === "cli" && (
                  <span className="chip">Claude: subscription</span>
                )}
                {p.jobsAreMocked && (
                  <span className="chip" style={{ color: "var(--warn)" }}>
                    Jobs: mock
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/** Any screen that spends money calls this so the header updates at once. */
export function refreshUsage() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("jobhunter:usage"));
  }
}
