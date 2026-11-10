import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "JobHunter",
  description:
    "Local job hunting: resume intake, recent matching roles, tailored resumes, assisted apply.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Nav />
        <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6">
          {children}
        </main>
      </body>
    </html>
  );
}
