/** @type {import('next').NextConfig} */
// API proxying is handled at runtime by app/api/[...path]/route.js (reads API_ORIGIN live),
// because next.config rewrites() are resolved at build time and can't pick up runtime env.
const nextConfig = {
  // Production serves the whole app under truehr.co.in/app (the root domain is
  // a static landing page handled by nginx). Empty in dev — no prefix locally.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default nextConfig;
