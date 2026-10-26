/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep the repo's own AGENTS.md authoritative; Next.js 16.3+ otherwise
  // writes a managed AGENTS.md into apps/web when `next dev` runs under an
  // AI coding agent.
  agentRules: false,
  transpilePackages: ["@workspace/ui"],
}

export default nextConfig
