import { bad, failed, ok } from "@/lib/api";
import { getJob, getProfile, latestTailoring } from "@/lib/db";
import type { Profile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// The "apply packet": everything needed to prefill an application form, plus
// an explicit list of what must never be filled in automatically.
//
// This endpoint produces DATA ONLY. Nothing here submits anything. The browser
// extension uses it to type values into a form and then stops.
// ---------------------------------------------------------------------------

export interface PrefillField {
  /** Field names an ATS is likely to use, for matching against the form. */
  aliases: string[];
  label: string;
  value: string;
  /** How sure we are this is right; "derived" values deserve a glance. */
  confidence: "certain" | "derived";
}

function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function findLink(links: string[], host: string): string {
  return links.find((l) => l.toLowerCase().includes(host)) ?? "";
}

function buildPrefill(profile: Profile): PrefillField[] {
  const { resume, preferences } = profile;
  const { first, last } = splitName(resume.fullName);
  const current = resume.roles[0];

  const fields: PrefillField[] = [
    {
      aliases: ["first_name", "firstName", "given-name", "fname"],
      label: "First name",
      value: first,
      confidence: resume.fullName ? "derived" : "certain",
    },
    {
      aliases: ["last_name", "lastName", "family-name", "lname", "surname"],
      label: "Last name",
      value: last,
      confidence: resume.fullName ? "derived" : "certain",
    },
    {
      aliases: ["full_name", "fullName", "name", "candidate_name"],
      label: "Full name",
      value: resume.fullName,
      confidence: "certain",
    },
    {
      aliases: ["email", "email_address", "e-mail"],
      label: "Email",
      value: resume.email,
      confidence: "certain",
    },
    {
      aliases: ["phone", "phone_number", "telephone", "mobile"],
      label: "Phone",
      value: resume.phone,
      confidence: "certain",
    },
    {
      aliases: ["location", "city", "current_location", "address_city"],
      label: "Location",
      value: resume.location,
      confidence: "certain",
    },
    {
      aliases: ["linkedin", "linkedin_url", "linkedin_profile"],
      label: "LinkedIn",
      value: findLink(resume.links, "linkedin.com"),
      confidence: "certain",
    },
    {
      aliases: ["github", "github_url"],
      label: "GitHub",
      value: findLink(resume.links, "github.com"),
      confidence: "certain",
    },
    {
      aliases: ["website", "portfolio", "personal_site", "url"],
      label: "Website / portfolio",
      value:
        resume.links.find(
          (l) =>
            !l.toLowerCase().includes("linkedin.com") &&
            !l.toLowerCase().includes("github.com"),
        ) ?? "",
      confidence: "certain",
    },
    {
      aliases: ["current_company", "employer", "current_employer"],
      label: "Current company",
      value: current?.company ?? "",
      confidence: "derived",
    },
    {
      aliases: ["current_title", "job_title", "current_position"],
      label: "Current title",
      value: current?.title ?? "",
      confidence: "derived",
    },
    {
      aliases: ["years_of_experience", "experience_years", "yoe"],
      label: "Years of experience",
      value: resume.yearsExperience ? String(resume.yearsExperience) : "",
      confidence: "derived",
    },
    {
      aliases: [
        "work_authorization",
        "authorized_to_work",
        "legally_authorized",
      ],
      label: "Work authorisation",
      value: preferences.workAuthorization,
      confidence: "certain",
    },
    {
      aliases: ["requires_sponsorship", "visa_sponsorship", "need_sponsorship"],
      label: "Requires sponsorship",
      value:
        preferences.needsSponsorship === null
          ? ""
          : preferences.needsSponsorship
            ? "Yes"
            : "No",
      confidence: "certain",
    },
    {
      aliases: ["start_date", "available_start", "earliest_start_date"],
      label: "Earliest start date",
      value: preferences.earliestStart,
      confidence: "certain",
    },
    {
      aliases: [
        "desired_salary",
        "salary_expectation",
        "expected_compensation",
      ],
      label: "Salary expectation",
      value: preferences.salaryFloor
        ? `${preferences.salaryFloor} ${preferences.salaryCurrency}`
        : "",
      confidence: "derived",
    },
    {
      aliases: ["willing_to_relocate", "relocate", "open_to_relocation"],
      label: "Willing to relocate",
      value: preferences.willingToRelocate ? "Yes" : "No",
      confidence: "certain",
    },
  ];

  return fields.filter((f) => f.value.trim().length > 0);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const job = getJob(id);
    if (!job) return bad("No such job.", 404);

    const profile = getProfile();
    if (!profile) return bad("Upload a resume first.", 404);

    const tailoring = latestTailoring(id);

    return ok({
      job: {
        id: job.id,
        title: job.title,
        company: job.company,
        applyUrl: job.applyUrl,
        applyIsDirect: job.applyIsDirect,
      },
      prefill: buildPrefill(profile),
      resumeToAttach: tailoring?.docxPath
        ? {
            label: "Tailored resume",
            downloadUrl: `/api/tailor/${tailoring.id}/download`,
          }
        : profile.resumeFilename
          ? { label: `Original resume (${profile.resumeFilename})`, downloadUrl: null }
          : null,
      // Stated here, not just in the UI, so the rule travels with the data.
      neverFill: [
        "Passwords, or creating an account on the employer's site",
        "Social security number, national insurance number or any government ID",
        "Date of birth",
        "Bank account or payment details",
        "Driver's licence or passport numbers",
        "Voluntary demographic questions (race, gender, disability, veteran status) - these are yours to answer or decline",
        "Any free-text question about why you want the role, unless you have read and approved the wording",
      ],
      rules: [
        "Fields are filled in, then control is handed back to you.",
        "The submit button is never pressed automatically.",
        "Nothing is uploaded or sent without you doing it yourself.",
      ],
    });
  } catch (err) {
    return failed(err, "apply packet");
  }
}
