import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: false,
  serverExternalPackages: ["mammoth", "xlsx"],
  outputFileTracingExcludes: {
    "*": [
      "node_modules/.prisma/client/libquery_engine-debian-*",
      "node_modules/@prisma/engines/**",
      "node_modules/pdfjs-dist/**",
      "public/pdf.worker.min.mjs",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  // turbopack config is for local dev only (next dev --turbopack)
  // Do NOT include turbopack here — it causes build failures on Netlify/CI
};

export default nextConfig;
