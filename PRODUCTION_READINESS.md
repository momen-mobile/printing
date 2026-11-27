# Production Readiness Report — Next.js 16 + Vercel + Cloudflare Workers

**Full record of everything verified and changed.** No production deploy was run by the agent, no
secrets were printed or committed, no production database was touched, no features were removed,
and no major dependencies were upgraded. (Pushing to `main` triggers your existing automatic
deployments; see "Remaining manual steps.")

Repository: `momen-mobile/printing`, branch `main`, production branch `main`.
Baseline commit at inspection: `ab49d66`. Framework: **Next.js 16.4.4**, **Prisma 6.19.3**,
**React 19.3.0**, Node 22, npm 10, `package-lock.json` v3. Vercel `npm run build` already passed.
See also `CLOUDFLARE.md`.

---

## 1. Root cause of the original Cloudflare failure

`The entry-point file at ".open-next/worker.js" was not found.`

`.open-next/worker.js` was **never produced**. `wrangler.jsonc` correctly sets
`main: ".open-next/worker.js"`, but:

1. **`@opennextjs/cloudflare` was not a declared dependency** (absent from `package.json`, not
   installed), so `npx @opennextjs/cloudflare build` relied on `npx` fetching an unpinned adapter
   at build time and the **OpenNext bundling step that writes `.open-next/worker.js`** was not
   guaranteed to run.
2. **`open-next.config.ts` was missing.**
3. The Cloudflare build effectively ran only stock **`npm run build`** (emits `.next/`, not
   `.open-next/worker.js`); the failure surfaced at **deploy** because `main` pointed to a missing file.

**Verified live:** `npx @opennextjs/cloudflare build` with no version resolves
**`@opennextjs/cloudflare@1.20.19`**, whose peer range is `next >=15.5.29 <16 || >=16.4.5` —
**incompatible with pinned Next 16.4.4**. The latest **stable compatible** adapter for
**Next 16.4.4** is **`@opennextjs/cloudflare@1.20.15`** (peer `next >=15.5.28 <16 || >=16.4.1`,
`wrangler ^4.148.0`; installed `wrangler 4.168.0`). **No Next/Prisma/React upgrade was made.**

**Verified fix:** pin `@opennextjs/cloudflare@1.20.15`, add `open-next.config.ts`, keep
`wrangler.jsonc`, run `npx @opennextjs/cloudflare build` → exits 0 and emits **`.open-next/worker.js`**
+ `.open-next/assets`, while `npm run build` (Vercel) is unchanged.

---

## 2. Phase 1 — Current state (inspected before changing anything)

- **App Router** Next 16 app. No `middleware.ts`/`proxy.ts`. `next.config.ts`:
  `cacheComponents:false`, `serverExternalPackages:["googleapis","mammoth","xlsx"]`, security headers.
  **`npm run build` = `prisma generate && next build --webpack`.** `prebuild`/`postinstall` run
  `scripts/copy-pdf-worker.mjs` + `scripts/generate-ico.mjs`. Scripts `dev/build/start/lint/typecheck/
  test/db:deploy/db:generate`. `netlify.toml` (Netlify, Node 20) unaffected. `.env*` ignored, none
  committed; local `.env` not read/printed. `AGENTS.md` mandates reading `node_modules/next/dist/docs`
  (done; Next 16 differs from prior knowledge).
- **Prisma:** `@prisma/client`+`prisma` **6.19.3**, `prisma-client-js`, **PostgreSQL**,
  `url=env("DATABASE_URL")`, `directUrl=env("DIRECT_URL")`. `src/lib/prisma.ts`: `new PrismaClient`
  with **native query engine**, `globalThis` cache, **no driver adapter**. `prisma generate` in `build`.
- **Auth/session:** `jose` **HS256 JWT** cookie `fm_session` (`SESSION_SECRET`, ≥24 chars),
  `src/lib/session*.ts`; profile cookie + `POST /api/auth/profile`; `requireSession`, `assertSameOrigin`
  (CSRF origin + `NEXT_PUBLIC_APP_URL`), in-memory `rateLimit`. **Google OAuth** (`googleapis`
  `OAuth2`, `DRIVE_SCOPES`, `/api/auth/google/connect`→`/api/auth/google/callback`, `completeOAuth`,
  refresh, `revokeToken`, state `safeEqual`). Google tokens **AES-256-GCM** (`node:crypto`,
  `ENCRYPTION_KEY` = 32-byte hex, `v1.iv.tag.data`).
- **Google Drive:** `googleapis` v3, server-side `getDriveContext`, resumable uploads to Google
  (`/api/drive/upload/init|complete|direct`), downloads `/api/drive/files/[id]/content`,
  `GOOGLE_DRIVE_ROOT_FOLDER_ID`. No local file persistence.
- **PDF/preview:** `pdf-lib`+`@pdf-lib/fontkit` server-side; `pdfjs-dist` browser worker
  (`public/pdf.worker.min.mjs`, copied by `copy-pdf-worker.mjs`); `mammoth` (DOCX); `xlsx`. 
- **Env var names used (no values):** `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`,
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_ACCOUNT_EMAIL`,
  `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `NEXT_PUBLIC_APP_URL`, `DEMO_MODE`, `NODE_ENV`.
- **Cloudflare before changes:** `wrangler.jsonc` already existed + correct (`main .open-next/worker.js`,
  `nodejs_compat`, `ASSETS`, `compatibility_date 2026-11-19`, `observability`, `name printing`); **but
  `@opennextjs/cloudflare` not in `package.json`/not installed**, **`open-next.config.ts` missing**, no
  `cf:*` scripts, `.open-next/` not generated. Only pre-existing diff was line-ending-only on
  `public/pdf.worker.min.mjs`. No secrets tracked.

---

## 3. Cloudflare compatibility problems identified (before modifying; nothing silently disabled)

1. **Prisma on Cloudflare edge (BLOCKER for DB routes on CF).** `prisma-client-js` uses a **native
   query engine**; on workerd: *"In order to run Prisma Client on edge runtime… Use Prisma Accelerate
   … or Use Driver Adapters."* **CF build passes; DB-backed routes would fail on CF. `nodejs_compat`
   does not fix it.** *Proposed minimal safe change (NOT implemented — needs test DB + approval, keep
   Vercel unchanged):* on **Cloudflare only**, `new PrismaClient({ adapter })` with **`@prisma/adapter-neon`**
   (Neon) or **`@prisma/adapter-pg`**, or **Prisma Accelerate**; keep `DATABASE_URL`/`DIRECT_URL`.
2. **Filesystem reads in server PDF.** `src/lib/stickers/*-pdf.ts` read `src/assets/fonts/Arial-Bold.ttf`,
   `public/fonts/...`, `public/est-logo.jpg` via `fs.readFileSync(process.cwd()+…)`; `api/est-rounds`
   `seedDefault` reads `src/lib/assets/Stats-per-Room.xlsx` + `\\192.168.1.230\…` UNC share. **No FS on
   Workers.** Already: **logo embedded base64** (`est-logo-base64`); font falls back to `HelveticaBold`
   (**no Arabic → Arabic PDFs would break on CF**). *Proposed minimal safe change (NOT implemented):*
   embed TTF as base64; drop `fs` + UNC fallback. Vercel output unchanged.
3. **`nodejs_compat` required.** `node:crypto`, `node:stream`, `Buffer`, `process.env`, `googleapis`,
   `mammoth`, `xlsx` need it; `@prisma/engines` native won't run on workerd (see #1). Set. 
4. **Cloudflare env not inherited from Vercel.** `NEXT_PUBLIC_APP_URL`, `GOOGLE_REDIRECT_URI`,
   `assertSameOrigin`, OAuth `redirectBase`, `GOOGLE_*`, `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`,
   `ENCRYPTION_KEY` must be set as Cloudflare secrets/vars; `.env` not deployed. 
5. **`DIRECT_URL`** required by Prisma schema; on CF set it (migrations run outside Workers; **not run**).
6. **`xlsx` from CDN tarball** + large `googleapis`/`mammoth`; `serverExternalPackages` is
   Vercel-oriented; CF build succeeds, runtime untested. 
7. **In-memory state per isolate.** `rate-limit` `Map`, `ttl-cache`, `print-tracker` cache, Prisma
   `globalThis` not shared across Worker isolates. *Proposed (not implemented):* KV/Durable Object. Not breaking.
8. **Mutations/seeds** (`/api/est/seed`, `/api/settings/reset`, `seedDefault`, `/api/drive` writes)
   hit DB; on CF they'd hit #1; nothing disabled. Pre-existing fragility: `seedDefault` reads
   non-existent `src/lib/assets/Stats-per-Room.xlsx` + UNC share; only `.csv` present.
9. **Windows:** OpenNext warns not fully compatible with Windows; prefer **WSL** for local CF preview.

---

## 4. Files created / changed (additive, minimal, reversible; Vercel preserved)

**Created**
- `PRODUCTION_READINESS.md` (this file), `CLOUDFLARE.md`.
- `open-next.config.ts` — `defineCloudflareConfig({})`. Cloudflare-only; ignored by Vercel.
- `.dev.vars.example` — safe template, **names only, empty values, no secrets.**
- `.gitignore` += `.open-next`, `.wrangler`, `.dev.vars`, `.dev.vars.*`, `!.dev.vars.example`, `.env.local`.
- package scripts `cf:build`, `cf:preview`, `cf:deploy`, `cf:typegen`. **`build` NOT overwritten.**

**Modified**
- `eslint.config.mjs`: `.open-next/**` added to `globalIgnores`. 
- `package.json` + `package-lock.json`: **`@opennextjs/cloudflare@1.20.15`** (exact, devDependency).
  No Next/Prisma/React/other major changes. (`@tailwindcss/postcss` only re-ordered by npm.)

**Unchanged / verified intact**
- `npm run build`, `start`, `lint`, `typecheck`, `test`, `postinstall`, `prebuild`, `db:*`.
- `next.config.ts`, `tsconfig.json`, `prisma/schema.prisma`, `src/**`, `netlify.toml`, `.env*`.
- **`wrangler.jsonc` unchanged** (already correct). Vercel workflow unchanged; **Vercel ignores
  `open-next.config.ts`/`wrangler.jsonc`/`.dev.vars`.** `public/pdf.worker.min.mjs`/`favicon.ico`
  only regenerated (line-endings). No secrets added.

---

## 5. Exact commands run (Phase 4/5/8)

**PASSED (exit 0, actually run)**
- `npm run build` → `prisma generate` + `next build --webpack`, TS, static gen (Vercel `npm run build`
  unchanged). First baseline ran without extra memory; later runs on this 2 GB box used
  `NODE_OPTIONS=--max-old-space-size=4096`.
- `npm run typecheck` (`tsc --noEmit`) with `NODE_OPTIONS=--max-old-space-size=4096`.
- `npm install -D @opennextjs/cloudflare@1.20.15 --save-exact`.
- `npx @opennextjs/cloudflare build` → **`Worker saved in .open-next/worker.js`; `.open-next/worker.js`
  EXISTS; `.open-next/assets`; wrangler config valid; no required runtime files missing; no secrets in
  generated artifacts** (with `NODE_OPTIONS=--max-old-space-size=4096` + long timeout).
- `npx @opennextjs/cloudflare preview --port <N>` → **`Ready on http://127.0.0.1:<N>`**, `env.ASSETS`
  local; `cf:preview`. 
- `npx eslint src` → completes (pre-existing findings; see below). `.open-next` ignored.
- `npx vitest run … --testTimeout=20000` (single test) passed.
- `npx vitest run` → **139 passed / 1 failed** then that test passed alone with `--testTimeout=20000`.

**FAILED (honestly reported)**
- `npx @opennextjs/cloudflare build` **without** `NODE_OPTIONS` on this 2 GB box → **JS heap OOM**
  in `next build` TS step (`FATAL ERROR…heap limit`, `Command failed: npm run build`). Not a code
  error; `npm run build` alone passed. Set `NODE_OPTIONS=--max-old-space-size=4096`. 
- `npx @opennextjs/cloudflare build` with **insufficient timeout** → timed out during
  `Applying code patches`/`Bundling…`; not a code error; passes with longer timeout.
- `npm run typecheck` without `NODE_OPTIONS` → OOM. 
- `npm run lint` → **PRE-EXISTING**: **290 errors + 207 warnings (497)** in `src`
  (`no-explicit-any`, `prefer-const`, `no-unused-vars`, `react-hooks/*`, `preserve-manual-memoization`,
  `set-state-in-effect`, …); on this slow/low-memory box also OOM/timeout; `.open-next` now ignored;
  **`next build` does not run ESLint**, so `npm run build` passes. Not introduced here; not auto-fixed.
- `npm test` → **139/140**; `stickers.test.ts › …without overflow` **`Test timed out in 5000ms`** on
  slow env; passes with `--testTimeout=20000`. No sticker code changed.
- **Prisma on Cloudflare preview:** `prisma:error … edge runtime… Use Driver Adapters`. 
- **wrangler:** `[wrangler:warn] Workers runtime crashed…restarting (crash #2)…reloading…ready` on
  this Windows/OpenNext local preview; routes still returned. No prod CF tested. 

**NOT RUN (rules):** `npx @opennextjs/cloudflare deploy`, `wrangler deploy`, `prisma migrate`,
`prisma db seed`, `git push`, production deploy. `cf:deploy` script added but not executed.

**Local Cloudflare preview URL:** `http://127.0.0.1:8787` (default) / `http://127.0.0.1:<N>` for
`--port <N>`; tested `:8791`,`:8793`,`:8795`. Only while `npx @opennextjs/cloudflare preview` runs.

---

## 6. Smoke tests (Phase 6) — PASSED vs NOT TESTED

**Cloudflare preview (no prod creds, no prod DB):** ✅ `/login` 200; `/` 200 (redirects to `/login`
w/o profile cookie); `/privacy` 200; `/terms` 200; **404** unknown; `/api/auth/profile` **GET** 200;
`/api/drive/status` **401** (no session); `/api/drive/files` **401**; no unsupported-Node-API crash on
these routes; static assets via `ASSETS`. ⚠️ `prisma:error…Driver Adapters` on DB access. 

**Vercel/Node (passed):** `npm run build`, TS, static gen; full test suite incl. **PDF generation
English+Arabic**, box-manifest, certificate stickers, floor, logistics (`fs` font works in Node),
EST parsing; `npm run typecheck`. 

**NOT TESTED (no creds / external service / would touch prod DB):** real **Google OAuth callback**,
**Google Drive** read/write, **resumable upload to Google**, **DB-backed pages/APIs on CF against a
real DB**, `prisma migrate`/`db:deploy`, `POST /api/auth/profile` on CF, authenticated dashboard on
CF, **PDF generation on CF runtime** (known `fs`-font issue; PDF passes in Node+Vercel), **production
Vercel + production Cloudflare deploys.** DB seeding not run. 

---

## 7. Required Cloudflare environment variables (NAMES only; no values)

Set as **Cloudflare Worker secrets/vars** (`wrangler secret put NAME` or dashboard); **not** inherited
from Vercel; **not** committed. See `.dev.vars.example`; local `.dev.vars` (git-ignored); copy `.env`
**never** deployed. 

**Runtime (required):** `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_ACCOUNT_EMAIL`,
`NEXT_PUBLIC_APP_URL`. **Optional:** `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `DEMO_MODE`. 
**Build time:** `NEXT_PUBLIC_APP_URL` (client inlining + runtime); Prisma `generate` reads schema (no
DB connection); `DATABASE_URL`/`DIRECT_URL` names needed by Prisma CLI. `DIRECT_URL` for migrations
(run outside Workers). `SESSION_SECRET` ≥24; `ENCRYPTION_KEY` 32 bytes/64-hex. `NODE_ENV`,`ASSETS`,
`CF_*` by platform/adapter. 

⚠️ **Pre-existing, NOT printed, NOT modified:** `src/lib/session.ts` has a **hardcoded fallback
`SESSION_SECRET`** when env unset; `src/lib/crypto.ts` has a **hardcoded fallback `ENCRYPTION_KEY`**
(64-hex). Violates "never hardcode secrets," contradicts required env, and risks reading tokens
encrypted under a committed key. Preserved for Vercel safety + minimal change. **Proposed (not done):**
remove fallbacks, require env, **rotate** `SESSION_SECRET` + `ENCRYPTION_KEY`, set in **Vercel +
Cloudflare** before changing. No value reproduced.

---

## 8. Remaining manual configuration steps (not done; need you / dashboard)

1. **Pushing to `main` triggers your existing automatic deployments on BOTH Vercel + Cloudflare.**
   Nothing was pushed/deployed by the agent; you chose to push. Ensure CF config (below) is ready
   first; **a push is not a substitute for production verification.** 
2. **Cloudflare Workers Builds (verify; you said already set):** Build `npx @opennextjs/cloudflare build`,
   Deploy `npx @opennextjs/cloudflare deploy`, Root `/`. Keep **`@opennextjs/cloudflare@1.20.15`**
   (`npm ci` from lockfile; don't let `npx` pull unversioned latest `1.20.19` needing `next>=16.4.5`).
   Node 22. `NODE_OPTIONS=--max-old-space-size=4096` if OOM. 
3. **Add Cloudflare secrets** (names in §7). `NEXT_PUBLIC_APP_URL`=CF origin (no trailing slash). 
4. **Google OAuth:** add CF callback `https://<cf-domain>/api/auth/google/callback` + JS origin;
   set `GOOGLE_REDIRECT_URI`; `GOOGLE_*`. 
5. **Prisma on Cloudflare — remaining blocker.** Approve **Cloudflare-only Prisma driver adapter**
   (`@prisma/adapter-neon`/`@prisma/adapter-pg`, Prisma 6.19.3, no major bump; keep Vercel unchanged;
   **non-production test DB**) **or** Prisma Accelerate. 
6. **PDF on Cloudflare:** approve embedding `Arial-Bold.ttf` + rely on embedded `est-logo.jpg`; drop
   `fs.readFileSync` + UNC fallback. 
7. **Local CF:** `cp .dev.vars.example .dev.vars` (fill; never commit); `npx @opennextjs/cloudflare
   preview`; `wrangler types`. **WSL** recommended. 
8. **Security (pre-existing):** remove hardcoded `SESSION_SECRET`/`ENCRYPTION_KEY` fallbacks + **rotate**;
   rotate credentials noted in `DEPLOYMENT.md`; keep env set in Vercel + Cloudflare. 
9. **Rate limiting on CF:** KV/Durable Object. 
10. **Lint:** 290 pre-existing ESLint errors; `npm run build` ignores ESLint. 
11. **DB:** `prisma migrate deploy` on **non-production** first; **never** migrations/seeds on prod. 
12. **CF `compatibility_date`/`nodejs_compat`** already set; verify vs installed `wrangler` at deploy. 

---

## 9. Vercel preservation checklist (verified)

- `npm run build` still passes; `build` script **not** replaced; `prisma generate` + `prebuild` intact.
- `next build --webpack`, `next start`, `lint`, `typecheck`, `test`, `db:*`, `netlify.toml`, `.env*`,
  `next.config.ts`, `tsconfig`, `prisma/schema.prisma`, `src/**` unchanged. 
- New files are ignored by Vercel; `@opennextjs/cloudflare` is a **devDependency**; `cf:*` additive. 
- Vercel production env must remain set; **not** relying on removed hardcoded secrets (none removed).
