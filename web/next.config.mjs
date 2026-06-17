/** @type {import('next').NextConfig} */
// API proxying is handled at runtime by app/api/[...path]/route.js (reads API_ORIGIN live),
// because next.config rewrites() are resolved at build time and can't pick up runtime env.
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
