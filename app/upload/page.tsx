"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { refreshUsage } from "@/components/Nav";
import { Banner, Spinner } from "@/components/ui";
import type { Profile } from "@/lib/types";

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    profile: Profile;
    paragraphCount: number;
    usedFallback: boolean;
    notice: string | null;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/resume", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Upload failed.");
        return;
      }
      setResult(data);
      refreshUsage();
    } catch (err) {
      setError(
        `Could not reach the server: ${(err as Error).message}. Is it still running?`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Your resume</h1>
        <p className="mt-1 text-sm text-muted">
          Word .docx only. Tailoring rewrites your document in place, so it
          needs the original file to keep your fonts, spacing and layout.
        </p>
      </header>

      {error && <Banner kind="error">{error}</Banner>}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void upload(file);
        }}
        className="card flex flex-col items-center justify-center gap-3 p-10 text-center"
        style={dragging ? { borderColor: "var(--accent)" } : undefined}
      >
        <p className="text-sm">
          Drop your <code>.docx</code> here, or
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          Choose file
        </button>
        {busy && <Spinner label="Reading and extracting your profile..." />}
        <p className="text-xs text-muted">
          Stays on this machine, in <code>data/resumes</code>. Nothing is
          uploaded anywhere except the text sent to Claude for extraction.
        </p>
      </div>

      {result && (
        <div className="space-y-4">
          <Banner kind={result.usedFallback ? "warn" : "good"}>
            {result.notice ??
              `Read ${result.paragraphCount} paragraphs and extracted your profile.`}
          </Banner>

          <div className="card p-4">
            <h2 className="mb-3 font-semibold">What was found</h2>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Row label="Name" value={result.profile.resume.fullName} />
              <Row label="Email" value={result.profile.resume.email} />
              <Row label="Phone" value={result.profile.resume.phone} />
              <Row label="Location" value={result.profile.resume.location} />
              <Row
                label="Years of experience"
                value={String(result.profile.resume.yearsExperience)}
              />
              <Row
                label="Seniority"
                value={result.profile.resume.seniority || ""}
              />
              <Row
                label="Roles found"
                value={String(result.profile.resume.roles.length)}
              />
              <Row
                label="Skills found"
                value={String(
                  result.profile.resume.skills.length +
                    result.profile.resume.tools.length,
                )}
              />
            </dl>
          </div>

          <div className="flex items-center gap-3">
            <button
              className="btn btn-primary"
              onClick={() => router.push("/preferences")}
            >
              Next: what you are looking for
            </button>
            <span className="text-xs text-muted">
              You will check and correct everything before any search runs.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-1">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">
        {value || <span style={{ color: "var(--warn)" }}>not found</span>}
      </dd>
    </div>
  );
}
