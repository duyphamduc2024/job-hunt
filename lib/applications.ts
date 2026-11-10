import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { listJobs } from "./db";
import { buildDocx } from "./docx";
import type {
  Application,
  CoverLetterExport,
  Job,
  Match,
  Profile,
  Tailoring,
} from "./types";

// ---------------------------------------------------------------------------
// One folder per application, on disk, so the user can see at a glance what
// they sent where - and so the artefacts outlive the database.
//
//   data/applications/
//     INDEX.md                               <- every application, by status
//     2026-11-10_Acme_Software-QA-Engineer/
//       README.md                            <- link, facts, match, checklist
//       job-description.md                   <- the posting, as captured
//       resume.docx                          <- the tailored resume
//       cover-letter.md / .docx
//       tailoring-notes.md                   <- every change, and what is NOT
//                                               supported by the resume
// ---------------------------------------------------------------------------

export const applicationsDir = path.join(config.dataDir, "applications");

function slug(s: string, max = 48): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, max)
      .replace(/^-|-$/g, "") || "untitled"
  );
}

export function folderNameFor(job: Job): string {
  const day = (job.postedAt ?? new Date().toISOString()).slice(0, 10);
  return `${day}_${slug(job.company, 28)}_${slug(job.title, 44)}`;
}

function money(job: Job): string {
  if (job.salaryMin == null && job.salaryMax == null) return "not stated";
  const fmt = (n: number) => n.toLocaleString("en-US");
  const cur = job.salaryCurrency ?? "";
  const per = job.salaryPeriod ? ` per ${job.salaryPeriod.toLowerCase()}` : "";
  if (job.salaryMin != null && job.salaryMax != null) {
    return `${cur} ${fmt(job.salaryMin)} - ${fmt(job.salaryMax)}${per}`.trim();
  }
  return `${cur} ${fmt((job.salaryMin ?? job.salaryMax)!)}${per}`.trim();
}

export interface ExportInput {
  profile: Profile;
  job: Job;
  match: Match | null;
  application: Application;
  tailoring: Tailoring | null;
  /** Absolute path to the tailored .docx, if one exists. */
  tailoredDocxPath: string | null;
  coverLetter: CoverLetterExport | null;
}

export interface ExportResult {
  dir: string;
  files: string[];
}

export async function exportApplication(
  input: ExportInput,
): Promise<ExportResult> {
  const { profile, job, match, application, tailoring, coverLetter } = input;
  const dir = path.join(applicationsDir, folderNameFor(job));
  await fs.mkdir(dir, { recursive: true });
  const files: string[] = [];

  const write = async (name: string, contents: string | Buffer) => {
    await fs.writeFile(path.join(dir, name), contents);
    files.push(name);
  };

  // --- README.md: the page you actually read later ---
  const readme = [
    `# ${job.title}`,
    `## ${job.company}`,
    "",
    `**Status:** ${application.status}` +
      (application.appliedAt
        ? ` (applied ${application.appliedAt.slice(0, 10)})`
        : ""),
    "",
    "| | |",
    "|---|---|",
    `| Apply link | <${job.applyUrl}> |`,
    `| Location | ${job.location || "not stated"} |`,
    `| Work mode | ${job.workMode ?? "not stated"} |`,
    `| Employment type | ${job.jobType ?? "not stated"} |`,
    `| Salary | ${money(job)} |`,
    `| Posted | ${job.postedAt?.slice(0, 10) ?? "unknown"} |`,
    `| Found via | ${(job.alsoSeenOn ?? []).join(", ") || job.source} |`,
    `| Applies direct to employer | ${job.applyIsDirect ? "yes" : "no, via a board"} |`,
    "",
  ];

  if (match) {
    readme.push(
      `## Match: ${match.score}/100`,
      match.scoredBy === "claude"
        ? "_Scored by Claude against your profile._"
        : "_Keyword overlap only - not scored by Claude._",
      "",
      "**Why it matched**",
      ...(match.reasons.length
        ? match.reasons.map((r) => `- ${r}`)
        : ["- (none recorded)"]),
      "",
      "**Gaps**",
      ...(match.gaps.length ? match.gaps.map((g) => `- ${g}`) : ["- (none recorded)"]),
      "",
    );
  }

  readme.push(
    "## Before you send",
    "",
    "- [ ] Re-read the tailored resume end to end",
    "- [ ] Check every change in `tailoring-notes.md`",
    "- [ ] Read `cover-letter.md` out loud; cut anything that is not true",
    "- [ ] Confirm the posting is still open",
    "- [ ] Attach the resume (and cover letter if they take one)",
    "- [ ] **You** press submit",
    "",
    "## What is in this folder",
    "",
    "| File | What |",
    "|---|---|",
    "| `job-description.md` | The posting as captured, so you can reread it before an interview |",
    "| `resume.docx` | The tailored resume sent for this role |",
    "| `cover-letter.md` / `.docx` | The cover letter |",
    "| `tailoring-notes.md` | Every change made, and what the resume cannot support |",
    "",
    `_Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} by JobHunter._`,
  );
  await write("README.md", readme.join("\n") + "\n");

  // --- the posting itself ---
  await write(
    "job-description.md",
    [
      `# ${job.title} — ${job.company}`,
      "",
      `Source: <${job.applyUrl}>`,
      `Captured: ${new Date().toISOString().slice(0, 10)}`,
      "",
      "---",
      "",
      job.description || "_No description was provided by the source._",
      "",
    ].join("\n"),
  );

  // --- resume ---
  if (input.tailoredDocxPath) {
    try {
      await fs.copyFile(input.tailoredDocxPath, path.join(dir, "resume.docx"));
      files.push("resume.docx");
    } catch {
      // Fall through: the notes still record what was intended.
    }
  } else if (profile.resumePath) {
    try {
      await fs.copyFile(
        profile.resumePath,
        path.join(dir, "resume-original.docx"),
      );
      files.push("resume-original.docx");
    } catch {
      /* ignore */
    }
  }

  // --- tailoring notes ---
  if (tailoring) {
    const notes = [
      `# Tailoring notes — ${job.company}`,
      "",
      `Model: ${tailoring.model}`,
      `Generated: ${tailoring.createdAt.slice(0, 16).replace("T", " ")}`,
      "",
      "## Strategy",
      "",
      tailoring.summary,
      "",
      `## Changes (${tailoring.changes.length})`,
      "",
    ];
    for (const c of tailoring.changes) {
      notes.push(
        `### Paragraph ${c.paragraphIndex}`,
        "",
        `- **Before:** ${c.before}`,
        `- **After:** ${c.after}`,
        `- **Why:** ${c.why}`,
        "",
      );
    }
    if (tailoring.emphasised.length) {
      notes.push(
        "## Brought forward",
        "",
        ...tailoring.emphasised.map((e) => `- ${e}`),
        "",
      );
    }
    if (tailoring.notAddressed.length) {
      notes.push(
        "## What this resume cannot support",
        "",
        "_Nothing was invented to cover these. Know them before an interview._",
        "",
        ...tailoring.notAddressed.map((n) => `- ${n}`),
        "",
      );
    }
    await write("tailoring-notes.md", notes.join("\n"));
  }

  // --- cover letter ---
  if (coverLetter) {
    const md = [
      `# Cover letter — ${job.company}`,
      "",
      "```",
      coverLetter.text,
      "```",
      "",
    ];
    if (coverLetter.claimsMade.length) {
      md.push(
        "## Claims this letter makes",
        "",
        "_Check each against your resume before sending._",
        "",
        ...coverLetter.claimsMade.map((c) => `- [ ] ${c}`),
        "",
      );
    }
    if (coverLetter.unverifiable.length) {
      md.push(
        "## ⚠ Claims that may not be supported",
        "",
        "_These did not clearly trace back to your resume. Verify or cut them._",
        "",
        ...coverLetter.unverifiable.map((c) => `- ${c}`),
        "",
      );
    }
    await write("cover-letter.md", md.join("\n"));
    await write("cover-letter.docx", await buildDocx(coverLetter.text.split("\n")));
  }

  await writeIndex();
  return { dir, files };
}

/** Regenerate the top-level index of every application folder. */
export async function writeIndex(): Promise<string> {
  await fs.mkdir(applicationsDir, { recursive: true });

  let folders: string[] = [];
  try {
    folders = (await fs.readdir(applicationsDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
  } catch {
    folders = [];
  }

  const byFolder = new Map<
    string,
    { job: Job; match: Match | null; application: Application }
  >();
  for (const item of listJobs({})) {
    byFolder.set(folderNameFor(item.job), item);
  }

  const ORDER = [
    "applied",
    "interviewing",
    "tailored",
    "saved",
    "new",
    "rejected",
    "dismissed",
  ];
  const rows = folders.map((f) => {
    const it = byFolder.get(f);
    return {
      folder: f,
      status: it?.application.status ?? "unknown",
      title: it?.job.title ?? f,
      company: it?.job.company ?? "",
      score: it?.match?.score ?? null,
      url: it?.job.applyUrl ?? "",
      applied: it?.application.appliedAt?.slice(0, 10) ?? "",
    };
  });
  rows.sort(
    (a, b) =>
      ORDER.indexOf(a.status) - ORDER.indexOf(b.status) ||
      (b.score ?? -1) - (a.score ?? -1),
  );

  const lines = [
    "# Applications",
    "",
    `${rows.length} tracked. Updated ${new Date()
      .toISOString()
      .slice(0, 16)
      .replace("T", " ")}.`,
    "",
    "| Status | Score | Role | Company | Applied | Folder |",
    "|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.status} | ${r.score ?? "-"} | ${
          r.url ? `[${r.title}](${r.url})` : r.title
        } | ${r.company} | ${r.applied || "-"} | [\`${r.folder}\`](./${encodeURI(
          r.folder,
        )}/README.md) |`,
    ),
    "",
    "_Status lives in the app; this file is regenerated on each export._",
  ];

  const indexPath = path.join(applicationsDir, "INDEX.md");
  await fs.writeFile(indexPath, lines.join("\n") + "\n");
  return indexPath;
}
