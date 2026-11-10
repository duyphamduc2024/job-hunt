import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module: it must stay external to the bundler.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
