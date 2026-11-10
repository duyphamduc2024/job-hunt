import * as z from "zod/v4";
import { bad, failed, ok } from "@/lib/api";
import { getProfile, saveProfile } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The profile is user-edited, so it is validated on the way in rather than
// trusted. Everything is required: blank means "" or [], not absent.
const RoleSchema = z.object({
  title: z.string(),
  company: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  location: z.string(),
  bullets: z.array(z.string()),
});

const ResumeSchema = z.object({
  fullName: z.string(),
  email: z.string(),
  phone: z.string(),
  location: z.string(),
  links: z.array(z.string()),
  summary: z.string(),
  roles: z.array(RoleSchema),
  yearsExperience: z.number().min(0).max(70),
  skills: z.array(z.string()),
  tools: z.array(z.string()),
  industries: z.array(z.string()),
  education: z.array(
    z.object({
      degree: z.string(),
      field: z.string(),
      school: z.string(),
      year: z.string(),
    }),
  ),
  certifications: z.array(z.string()),
  seniority: z.string(),
});

const PreferencesSchema = z.object({
  targetTitles: z.array(z.string()),
  excludeTitles: z.array(z.string()),
  seniority: z.array(z.string()),
  locations: z.array(z.string()),
  workModes: z.array(z.string()),
  jobTypes: z.array(z.string()),
  salaryFloor: z.number().nullable(),
  salaryCurrency: z.string(),
  workAuthorization: z.string(),
  needsSponsorship: z.boolean().nullable(),
  willingToRelocate: z.boolean(),
  earliestStart: z.string(),
  companySizes: z.array(z.string()),
  excludeCompanies: z.array(z.string()),
  notes: z.string(),
});

const BodySchema = z.object({
  resume: ResumeSchema.optional(),
  preferences: PreferencesSchema.optional(),
  /** Set true from the review screen to mark the profile ready for search. */
  confirm: z.boolean().optional(),
});

export async function GET() {
  try {
    return ok({ profile: getProfile() });
  } catch (err) {
    return failed(err, "profile get");
  }
}

export async function PUT(req: Request) {
  try {
    const existing = getProfile();
    if (!existing) {
      return bad("No profile yet. Upload a resume first.", 404);
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return bad(
        `Could not save: ${parsed.error.issues
          .map((i) => `${i.path.join(".")} ${i.message}`)
          .join("; ")}`,
      );
    }

    const body = parsed.data;
    const saved = saveProfile({
      ...existing,
      resume: (body.resume ?? existing.resume) as typeof existing.resume,
      preferences: (body.preferences ??
        existing.preferences) as typeof existing.preferences,
      confirmedAt: body.confirm
        ? new Date().toISOString()
        : existing.confirmedAt,
      updatedAt: new Date().toISOString(),
    });

    return ok({ profile: saved });
  } catch (err) {
    return failed(err, "profile put");
  }
}
