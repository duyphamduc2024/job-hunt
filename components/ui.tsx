"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// Small shared pieces. Nothing clever - just the patterns that would
// otherwise be copy-pasted across five screens.
// ---------------------------------------------------------------------------

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted">
      <span
        aria-hidden
        className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-accent"
      />
      {label}
    </span>
  );
}

export function Banner({
  kind,
  children,
  onDismiss,
}: {
  kind: "error" | "warn" | "info" | "good";
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  const color =
    kind === "error"
      ? "var(--bad)"
      : kind === "warn"
        ? "var(--warn)"
        : kind === "good"
          ? "var(--good)"
          : "var(--accent)";
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className="mb-4 flex items-start gap-3 rounded-lg border p-3 text-sm"
      style={{
        borderColor: color,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
    >
      <div className="flex-1 whitespace-pre-wrap">{children}</div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 text-xs underline opacity-70"
          aria-label="Dismiss"
        >
          dismiss
        </button>
      )}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/**
 * Editable list of short strings. Used for skills, target titles, locations
 * and the rest - all the fields where the extractor gets most of it right and
 * the user needs to fix a couple of entries.
 */
export function TagList({
  values,
  onChange,
  placeholder,
  suggestions = [],
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    // Commas let someone paste "SQL, Python, dbt" and get three tags.
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...values];
    for (const p of parts) {
      if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    }
    onChange(next);
    setDraft("");
  }

  const unused = suggestions.filter(
    (s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {values.map((v, i) => (
          <span key={`${v}-${i}`} className="chip">
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((_, j) => j !== i))}
              className="opacity-50 hover:opacity-100"
              aria-label={`Remove ${v}`}
            >
              &times;
            </button>
          </span>
        ))}
        {values.length === 0 && (
          <span className="text-xs text-muted">None yet</span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          className="input"
          value={draft}
          placeholder={placeholder ?? "Type and press Enter"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            }
            if (e.key === "Backspace" && !draft && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
        />
        <button type="button" className="btn" onClick={() => add(draft)}>
          Add
        </button>
      </div>
      {unused.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">Suggestions:</span>
          {unused.slice(0, 8).map((s) => (
            <button
              key={s}
              type="button"
              className="chip hover:border-accent hover:text-accent"
              onClick={() => add(s)}
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CheckRow<T extends string>({
  options,
  values,
  onChange,
  labels = {} as Record<T, string>,
}: {
  options: readonly T[];
  values: T[];
  onChange: (next: T[]) => void;
  labels?: Partial<Record<T, string>>;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const on = values.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={on}
            onClick={() =>
              onChange(on ? values.filter((v) => v !== opt) : [...values, opt])
            }
            className="chip"
            style={
              on
                ? {
                    borderColor: "var(--accent)",
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                  }
                : undefined
            }
          >
            {labels[opt] ?? opt}
          </button>
        );
      })}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone: Record<string, string> = {
    new: "var(--muted)",
    saved: "var(--accent)",
    tailored: "var(--accent)",
    applied: "var(--good)",
    interviewing: "var(--good)",
    rejected: "var(--bad)",
    dismissed: "var(--muted)",
  };
  const color = tone[status] ?? "var(--muted)";
  return (
    <span
      className="chip"
      style={{
        borderColor: color,
        color,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
    >
      {status}
    </span>
  );
}

export function daysAgo(iso: string | null): string {
  if (!iso) return "date unknown";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function formatSalary(
  min: number | null,
  max: number | null,
  period: string | null,
  currency: string | null,
): string | null {
  if (min == null && max == null) return null;
  const cur = currency ?? "";
  const per = period ? `/${period.toLowerCase()}` : "";
  const fmt = (n: number) =>
    n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));
  if (min != null && max != null) {
    return `${cur} ${fmt(min)}-${fmt(max)}${per}`.trim();
  }
  return `${cur} ${fmt((min ?? max)!)}${per}`.trim();
}
