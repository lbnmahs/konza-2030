import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Do not write AGENTS.md / CLAUDE.md on `next dev` (their text has dashes the repo forbids).
  agentRules: false,
};

export default nextConfig;
