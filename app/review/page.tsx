"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Banner, Field, Spinner, TagList } from "@/components/ui";
import type { Profile, ResumeProfile, Seniority } from "@/lib/types";

const SENIORITY: readonly (Seniority | "")[] = [
  "",
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

export default function ReviewPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [resume, setResume] = useState<ResumeProfile | null>(null);
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
          setResume(d.profile.resume);
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  function set<K extends keyof ResumeProfile>(
    key: K,
    value: ResumeProfile[K],
  ) {
    setResume((r) => (r ? { ...r, [key]: value } : r));
    setSaved(false);
  }

  async function save(confirm: boolean) {
    if (!resume) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume, confirm }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save.");
        return;
      }
      setProfile(data.profile);
      setSaved(true);
      if (confirm) router.push("/jobs");
    } catch (err) {
      setError(`Could not save: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner label="Loading your profile..." />;

  if (!resume) {
    return (
      <Banner kind="warn">
        No profile yet.{" "}
        <a className="underline" href="/upload">
          Upload your resume
        </a>{" "}
        to get started.
      </Banner>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Check what was read off your resume
        </h1>
        <p className="mt-1 text-sm text-muted">
          Extraction is good but not perfect, and everything here feeds both the
          search and the resume tailoring. Fix anything wrong before you
          continue - a wrong skills list quietly ruins every match score.
        </p>
        {profile?.confirmedAt && (
          <p className="mt-1 text-xs text-muted">
            Last confirmed {new Date(profile.confirmedAt).toLocaleString()}.
          </p>
        )}
      </header>

      {error && <Banner kind="error">{error}</Banner>}
      {saved && <Banner kind="good">Saved.</Banner>}

      <section className="card space-y-4 p-4">
        <h2 className="font-semibold">Contact</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <input
              className="input"
              value={resume.fullName}
              onChange={(e) => set("fullName", e.target.value)}
            />
          </Field>
          <Field label="Email">
            <input
              className="input"
              value={resume.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          <Field label="Phone">
            <input
              className="input"
              value={resume.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </Field>
          <Field label="Location">
            <input
              className="input"
              value={resume.location}
              onChange={(e) => set("location", e.target.value)}
            />
          </Field>
        </div>
        <Field label="Links" hint="LinkedIn, GitHub, portfolio. Used to prefill application forms.">
          <TagList
            values={resume.links}
            onChange={(v) => set("links", v)}
            placeholder="https://linkedin.com/in/..."
          />
        </Field>
      </section>

      <section className="card space-y-4 p-4">
        <h2 className="font-semibold">Standing</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Years of experience"
            hint="Computed from your role dates. Correct it if it counted internships or overlaps wrongly."
          >
            <input
              type="number"
              className="input"
              value={resume.yearsExperience}
              onChange={(e) =>
                set("yearsExperience", Number(e.target.value) || 0)
              }
            />
          </Field>
          <Field label="Seniority your resume evidences">
            <select
              className="input"
              value={resume.seniority}
              onChange={(e) => set("seniority", e.target.value as Seniority)}
            >
              {SENIORITY.map((s) => (
                <option key={s} value={s}>
                  {s || "not set"}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Summary" hint="Your resume's own summary. Tailoring may rewrite this to foreground what a posting cares about.">
          <textarea
            className="input"
            rows={3}
            value={resume.summary}
            onChange={(e) => set("summary", e.target.value)}
          />
        </Field>
      </section>

      <section className="card space-y-4 p-4">
        <h2 className="font-semibold">Skills and tools</h2>
        <p className="text-xs text-muted">
          These drive the free prefilter that decides which postings are worth
          paying to score. Worth getting right.
        </p>
        <Field label="Skills">
          <TagList values={resume.skills} onChange={(v) => set("skills", v)} />
        </Field>
        <Field label="Tools and technologies">
          <TagList values={resume.tools} onChange={(v) => set("tools", v)} />
        </Field>
        <Field label="Industries">
          <TagList
            values={resume.industries}
            onChange={(v) => set("industries", v)}
          />
        </Field>
        <Field label="Certifications">
          <TagList
            values={resume.certifications}
            onChange={(v) => set("certifications", v)}
          />
        </Field>
      </section>

      <section className="card space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">
            Roles ({resume.roles.length})
          </h2>
          <button
            className="btn"
            onClick={() =>
              set("roles", [
                ...resume.roles,
                {
                  title: "",
                  company: "",
                  startDate: "",
                  endDate: "",
                  location: "",
                  bullets: [],
                },
              ])
            }
          >
            Add role
          </button>
        </div>
        {resume.roles.length === 0 && (
          <p className="text-sm" style={{ color: "var(--warn)" }}>
            No roles were found. Tailoring rewrites your achievement bullets, so
            add at least your current role.
          </p>
        )}
        {resume.roles.map((role, i) => (
          <div key={i} className="rounded-lg border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title">
                <input
                  className="input"
                  value={role.title}
                  onChange={(e) =>
                    set(
                      "roles",
                      resume.roles.map((r, j) =>
                        j === i ? { ...r, title: e.target.value } : r,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="Company">
                <input
                  className="input"
                  value={role.company}
                  onChange={(e) =>
                    set(
                      "roles",
                      resume.roles.map((r, j) =>
                        j === i ? { ...r, company: e.target.value } : r,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="Start">
                <input
                  className="input"
                  value={role.startDate}
                  placeholder="Mar 2021"
                  onChange={(e) =>
                    set(
                      "roles",
                      resume.roles.map((r, j) =>
                        j === i ? { ...r, startDate: e.target.value } : r,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="End">
                <input
                  className="input"
                  value={role.endDate}
                  placeholder="Present"
                  onChange={(e) =>
                    set(
                      "roles",
                      resume.roles.map((r, j) =>
                        j === i ? { ...r, endDate: e.target.value } : r,
                      ),
                    )
                  }
                />
              </Field>
            </div>
            <div className="mt-3">
              <Field
                label="Achievement bullets"
                hint="One per line. These are what tailoring reorders and rewords - it will never add a number that is not already here."
              >
                <textarea
                  className="input font-mono text-xs"
                  rows={Math.max(3, role.bullets.length + 1)}
                  value={role.bullets.join("\n")}
                  onChange={(e) =>
                    set(
                      "roles",
                      resume.roles.map((r, j) =>
                        j === i
                          ? {
                              ...r,
                              bullets: e.target.value
                                .split("\n")
                                .map((b) => b.trim())
                                .filter(Boolean),
                            }
                          : r,
                      ),
                    )
                  }
                />
              </Field>
            </div>
            <button
              className="btn mt-3"
              style={{ color: "var(--bad)" }}
              onClick={() =>
                set(
                  "roles",
                  resume.roles.filter((_, j) => j !== i),
                )
              }
            >
              Remove this role
            </button>
          </div>
        ))}
      </section>

      <section className="card space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Education</h2>
          <button
            className="btn"
            onClick={() =>
              set("education", [
                ...resume.education,
                { degree: "", field: "", school: "", year: "" },
              ])
            }
          >
            Add
          </button>
        </div>
        {resume.education.map((ed, i) => (
          <div
            key={i}
            className="grid items-end gap-3 rounded-lg border border-border p-3 sm:grid-cols-5"
          >
            {(["degree", "field", "school", "year"] as const).map((k) => (
              <Field key={k} label={k}>
                <input
                  className="input"
                  value={ed[k]}
                  onChange={(e) =>
                    set(
                      "education",
                      resume.education.map((x, j) =>
                        j === i ? { ...x, [k]: e.target.value } : x,
                      ),
                    )
                  }
                />
              </Field>
            ))}
            <button
              className="btn"
              style={{ color: "var(--bad)" }}
              onClick={() =>
                set(
                  "education",
                  resume.education.filter((_, j) => j !== i),
                )
              }
            >
              Remove
            </button>
          </div>
        ))}
      </section>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <button
          className="btn btn-primary"
          disabled={saving}
          onClick={() => void save(true)}
        >
          {saving ? "Saving..." : "Looks right - find jobs"}
        </button>
        <button className="btn" disabled={saving} onClick={() => void save(false)}>
          Save without continuing
        </button>
        <a className="btn" href="/upload">
          Replace resume
        </a>
      </div>
    </div>
  );
}
