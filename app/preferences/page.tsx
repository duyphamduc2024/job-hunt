"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Banner, CheckRow, Field, Spinner, TagList } from "@/components/ui";
import type {
  JobType,
  Preferences,
  Profile,
  Seniority,
  WorkMode,
} from "@/lib/types";

const SENIORITY: readonly Seniority[] = [
  "intern",
  "entry",
  "mid",
  "senior",
  "staff",
  "principal",
  "manager",
  "director",
  "executive",
];

const WORK_MODES: readonly WorkMode[] = ["remote", "hybrid", "onsite"];

const JOB_TYPES: readonly JobType[] = [
  "fulltime",
  "parttime",
  "contract",
  "internship",
  "temporary",
];

const COMPANY_SIZES = [
  "1-10",
  "11-50",
  "51-200",
  "201-1000",
  "1001-5000",
  "5000+",
] as const;

export default function PreferencesPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => {
        if (d.profile) {
          setProfile(d.profile);
          setPrefs(d.profile.preferences);
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  function set<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPrefs((p) => (p ? { ...p, [key]: value } : p));
    setSaved(false);
  }

  async function save(thenGo: boolean) {
    if (!prefs) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: prefs }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save.");
        return;
      }
      setSaved(true);
      if (thenGo) router.push("/review");
    } catch (err) {
      setError(`Could not save: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner label="Loading your preferences..." />;

  if (!prefs) {
    return (
      <Banner kind="warn">
        No profile yet. <a className="underline" href="/upload">Upload your resume</a>{" "}
        first - these preferences are stored alongside it.
      </Banner>
    );
  }

  const titleSuggestions = Array.from(
    new Set((profile?.resume.roles ?? []).map((r) => r.title).filter(Boolean)),
  );
  const locationSuggestions = Array.from(
    new Set(
      ["Remote", profile?.resume.location].filter(
        (v): v is string => Boolean(v),
      ),
    ),
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          What you are looking for
        </h1>
        <p className="mt-1 text-sm text-muted">
          None of this is on your resume, and all of it changes which jobs come
          back. This is the screen that makes search results good rather than
          generic.
        </p>
      </header>

      {error && <Banner kind="error">{error}</Banner>}
      {saved && <Banner kind="good">Saved.</Banner>}

      <section className="card space-y-4 p-4">
        <h2 className="font-semibold">Roles</h2>

        <Field
          label="Target job titles"
          hint="Each one becomes a search query, so two or three specific titles beat ten vague ones. Required."
        >
          <TagList
            values={prefs.targetTitles}
            onChange={(v) => set("targetTitles", v)}
            placeholder="e.g. Data Analyst"
            suggestions={titleSuggestions}
          />
        </Field>

        <Field
          label="Titles to exclude"
          hint="Postings whose title contains any of these are dropped before you ever see them."
        >
          <TagList
            values={prefs.excludeTitles}
            onChange={(v) => set("excludeTitles", v)}
            placeholder="e.g. Sales Engineer"
          />
        </Field>

        <Field label="Seniority you would accept">
          <CheckRow
            options={SENIORITY}
            values={prefs.seniority}
            onChange={(v) => set("seniority", v)}
          />
        </Field>
      </section>

      <section className="card space-y-4 p-4">
        <h2 className="font-semibold">Where and how</h2>

        <Field
          label="Locations"
          hint='Use "Remote" for remote-only searches, or a city like "Austin, TX". Each location is paired with each title, and the total number of queries is capped at four per search to protect your request allowance.'
        >
          <TagList
            values={prefs.locations}
            onChange={(v) => set("locations", v)}
            placeholder="e.g. Remote"
            suggestions={locationSuggestions}
          />
        </Field>

        <Field label="Work modes">
          <CheckRow
            options={WORK_MODES}
            values={prefs.workModes}
            onChange={(v) => set("workModes", v)}
          />
        </Field>

        <Field label="Employment types">
          <CheckRow
            options={JOB_TYPES}
            values={prefs.jobTypes}
            onChange={(v) => set("jobTypes", v)}
            labels={{
              fulltime: "full time",
              parttime: "part time",
            }}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Salary floor"
            hint="Used to down-rank postings whose stated maximum is below it. Blank means no floor."
          >
            <div className="flex gap-2">
              <input
                type="number"
                className="input"
                value={prefs.salaryFloor ?? ""}
                placeholder="e.g. 120000"
                onChange={(e) =>
                  set(
                    "salaryFloor",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
              <input
                className="input"
                style={{ maxWidth: "6rem" }}
                value={prefs.salaryCurrency}
                onChange={(e) => set("salaryCurrency", e.target.value)}
              />
            </div>
          </Field>

          <Field label="Open to relocation">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={prefs.willingToRelocate}
                onChange={(e) => set("willingToRelocate", e.target.checked)}
              />
              Yes, I would move for the right role
            </label>
          </Field>
        </div>

        <Field label="Company sizes you prefer" hint="Leave empty for no preference.">
          <CheckRow
            options={COMPANY_SIZES}
            values={prefs.companySizes as (typeof COMPANY_SIZES)[number][]}
            onChange={(v) => set("companySizes", v as string[])}
          />
        </Field>

        <Field
          label="Companies to exclude"
          hint="Current employer, places you have already been rejected, anywhere you will not work."
        >
          <TagList
            values={prefs.excludeCompanies}
            onChange={(v) => set("excludeCompanies", v)}
            placeholder="e.g. Acme Corp"
          />
        </Field>
      </section>

      <section className="card space-y-4 p-4">
        <h2 className="font-semibold">Eligibility and timing</h2>
        <p className="text-xs text-muted">
          These get prefilled into application forms, and they affect scoring:
          a role that cannot sponsor is not a match if you need sponsorship.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Work authorisation"
            hint="In your own words, as you would write it on a form."
          >
            <input
              className="input"
              value={prefs.workAuthorization}
              placeholder="e.g. US citizen, no sponsorship needed"
              onChange={(e) => set("workAuthorization", e.target.value)}
            />
          </Field>

          <Field label="Do you need visa sponsorship?">
            <select
              className="input"
              value={
                prefs.needsSponsorship === null
                  ? ""
                  : prefs.needsSponsorship
                    ? "yes"
                    : "no"
              }
              onChange={(e) =>
                set(
                  "needsSponsorship",
                  e.target.value === "" ? null : e.target.value === "yes",
                )
              }
            >
              <option value="">Prefer not to say</option>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </Field>

          <Field label="Earliest start date">
            <input
              className="input"
              value={prefs.earliestStart}
              placeholder="e.g. Immediately, or 2 weeks notice"
              onChange={(e) => set("earliestStart", e.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Anything else worth knowing"
          hint="Free text, passed to the matcher. e.g. 'avoid heavy travel', 'want a smaller team', 'moving to Portland in March'."
        >
          <textarea
            className="input"
            rows={3}
            value={prefs.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          className="btn btn-primary"
          disabled={saving || !prefs.targetTitles.length}
          onClick={() => void save(true)}
        >
          {saving ? "Saving..." : "Save and review profile"}
        </button>
        <button className="btn" disabled={saving} onClick={() => void save(false)}>
          Save and stay here
        </button>
        {!prefs.targetTitles.length && (
          <span className="text-xs" style={{ color: "var(--warn)" }}>
            Add at least one target job title to continue.
          </span>
        )}
      </div>
    </div>
  );
}
