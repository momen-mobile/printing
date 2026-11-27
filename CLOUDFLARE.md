# Cloudflare Workers (OpenNext) — in addition to Vercel

This project deploys to **both** Vercel and Cloudflare Workers from the same codebase.
Nothing here changes the standard Next.js build used by Vercel.

## Vercel (unchanged)

```bash
npm run build        # prisma generate && next build --webpack
npm run start
```

Vercel ignores `open-next.config.ts`, `wrangler.jsonc`, `.dev.vars*`, and `.open-next/`.

## Cloudflare Workers (additive)

Adapter: **`@opennextjs/cloudflare@1.20.15`** (stable; peer `next >=15.5.28 <16 || >=16.4.1`,
satisfied by **Next 16.4.4**; requires **`wrangler ^4.148.0`**, installed **4.168.0**).
Next.js is **not** upgraded; Prisma is **not** upgraded.

```bash
# Cloudflare build command (already in Cloudflare dashboard)
npx @opennextjs/cloudflare build

# same thing via package script
npm run cf:build

# local preview in the Workers runtime (no production deploy)
npx @opennextjs/cloudflare preview      # http://127.0.0.1:8787
npm run cf:preview

# generate Worker types
npm run cf:typegen

# deploy — NOT run here; requires explicit approval
npx @opennextjs/cloudflare deploy       # or `npm run cf:deploy`
```

The Cloudflare build runs the existing `npm run build` (`prebuild` + `prisma generate` +
`next build --webpack`) and then emits **`.open-next/worker.js`** plus `.open-next/assets`,
matching `wrangler.jsonc` (`main`, `assets.directory`, `nodejs_compat`, `ASSETS` binding).

> **Memory:** on memory-constrained local machines, set `NODE_OPTIONS=--max-old-space-size=4096`
> for `npx @opennextjs/cloudflare build`. Cloudflare's build image generally has enough RAM.

### Files

- `open-next.config.ts` — `defineCloudflareConfig({})` (Cloudflare-only; ignored by Vercel)
- `wrangler.jsonc` — `main: .open-next/worker.js`, `nodejs_compat`, `ASSETS`, `compatibility_date`
- `.dev.vars.example` — safe template of **names only** (no values); copy to `.dev.vars` (git-ignored)
- `.gitignore` — ignores `.open-next`, `.wrangler`, `.dev.vars`, `.dev.vars.*`, `.env.local`, `!.dev.vars.example`
- `eslint.config.mjs` — ignore `.open-next/**`
- package scripts `cf:build`, `cf:preview`, `cf:deploy`, `cf:typegen`

### Required Cloudflare variables (names only — set as Worker secrets/vars; never commit values)

Runtime: `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_ACCOUNT_EMAIL`, `NEXT_PUBLIC_APP_URL`.
Optional: `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `DEMO_MODE`. `DIRECT_URL` is used by Prisma migrations.
`NEXT_PUBLIC_APP_URL` is read at build time (client inlining) and runtime.
Cloudflare vars are **not** inherited from Vercel. `.env` is **not** deployed; use `.dev.vars`
locally and Cloudflare secrets in production. No secrets are committed.

## Known Cloudflare runtime caveats (NOT silently fixed — see final report)

1. **Prisma on edge:** `@prisma/client` (`prisma-client-js`, native query engine) errors on
   Cloudflare: *"In order to run Prisma Client on edge runtime … Use Driver Adapters."*
   Cloudflare **build** passes; DB-backed routes need a Prisma driver adapter on Cloudflare
   (e.g. `@prisma/adapter-neon` / `@prisma/adapter-pg`) **or** Prisma Accelerate. Vercel path
   unchanged. Not implemented here (needs a test DB + approval).
2. **Filesystem reads:** server PDF code reads `src/assets/fonts/Arial-Bold.ttf`,
   `public/est-logo.jpg`, and (EST seed) `src/lib/assets/Stats-per-Room.xlsx` / a `\\192.168.1.230`
   share via `fs`. No FS on Workers. Logo is already embedded (`est-logo-base64`); **font is not**
   (falls back to `HelveticaBold`, which lacks Arabic). Proposed minimal fix: embed font bytes
   (like `est-logo-base64`) instead of `fs.readFileSync`. Not implemented here.
3. **Rate limiting** is in-memory per isolate; on Workers it is not shared. Proposed: back it
   with a Cloudflare Durable Object / KV. Not implemented here.
4. **Windows:** OpenNext warns it is not fully compatible with Windows; prefer WSL for local
   Cloudflare preview. `nodejs_compat` is required.
