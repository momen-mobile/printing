import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: false,
  serverExternalPackages: ["googleapis", "mammoth", "xlsx"],
  // turbopack config is for local dev only (next dev --turbopack)
  // Do NOT include turbopack here — it causes build failures on Netlify/CI
};

export default nextConfig;
