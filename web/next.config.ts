import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Correspondence attachments are uploaded through a server action, and the
    // default body limit is 1 MB — a scanned letter would fail on it. The
    // action itself refuses anything over 25 MB with a message that says so;
    // this only has to be large enough for that check to be the one that runs.
    serverActions: { bodySizeLimit: '30mb' },
  },
  // Tax records must never be cached by an intermediary or left in the
  // browser's back/forward cache. Every response is private and revalidated.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
