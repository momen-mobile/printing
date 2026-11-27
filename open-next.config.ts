import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Cloudflare Workers adapter configuration.
// This file is used ONLY by the OpenNext Cloudflare build (`npx @opennextjs/cloudflare build`).
// It does NOT affect the standard Next.js build used by Vercel (`npm run build`).
//
// Keep this minimal. Vercel uses `next build` directly and ignores this file.
export default defineCloudflareConfig({});
