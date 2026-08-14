# CLAUDE.md

Guidance for AI assistants working in this repository.

## What this is

**Sum Up** — a Splid-style group expense splitter. No user accounts: a group's
unguessable slug (`/g/:slug`) *is* the credential. Offline-first PWA,
multi-currency, DE/EN, auto-categorization, and several AI-assisted ways to get
expenses in (image, voice, text, clipboard).

[`PLAN.md`](PLAN.md) is the **spec of record** — product decisions, technical
design and route map live there. Read it before changing behaviour; update it
when a decision changes. `README.md` covers setup and deployment.

## Stack

React Router 8 (framework mode, SSR) · React 19 · Tailwind 4 · TypeScript
(strict) · Vite 8 · Vitest 4 · Postgres via `postgres.js` · Supabase (Postgres +
Realtime broadcast) · Gemini (optional) · deployed on Vercel (`fra1`).

## Commands

```bash
npm run dev        # react-router dev (port 5173)
npm run build      # production build
npm run start      # serve the build
npm run typecheck  # react-router typegen && tsc   <-- CI gate
npm run test       # vitest run                    <-- CI gate
node scripts/gen-icons.mjs   # regenerate PWA icons
```

There is **no linter/formatter**. CI (`.github/workflows/ci.yml`, Node 22) runs
`npm ci`, `npm run typecheck`, `npm run test` on every push and PR — run both
locally before pushing.

Local database:

```bash
docker run -d --name sumup-pg -e POSTGRES_PASSWORD=sumup_dev -e POSTGRES_DB=sumup \
  -p 55432:5432 postgres:17-alpine
docker exec -i sumup-pg psql -U postgres -d sumup < supabase/migration/0001_init.sql
```

`DATABASE_URL` is the only required env var (put it in `.env`; `vite.config.ts`
loads it into `process.env` for server code in dev). Optional:
`SUPABASE_URL` + `SUPABASE_ANON_KEY` (realtime doorbell), `GEMINI_API_KEY`
(+ `GEMINI_MODELS` override). **Everything must degrade gracefully without the
optional ones** — that is a hard product rule, not a nicety.

## Layout

```
app/
  root.tsx              root loader (locale + supabase config), Layout, useT()
  routes.ts             the route manifest — routes are declared here, not by file name
  routes/               route modules (loader / clientLoader / action / default export)
  components/           EntryForm (shared by new-expense/new-payment/edit), DuplicateWarning, icons
  lib/
    *.ts                pure domain logic — money, split, balances, categories,
                        duplicates, extract, parse-ops, accent, currencies
    *.test.ts           vitest tests, colocated
    types.ts            shared domain types + the SyncOp union
    i18n/               en.ts (source of truth), de.ts, index.ts
    server/*.server.ts  server-only: db, queries, sync, doorbell, gemini,
                        extract/text/voice/vision/prompt, cookies, background
    client/*.ts         browser-only: idb, outbox, overlay, claim, image, audio,
                        clipboard, warm
supabase/
  migration/0001_init.sql   the migration to apply (README calls it db/0001_init.sql)
  schema.sql                dumped schema
public/sw.js            service worker (app shell, page + photo caches)
.agents/skills/react-router/   vendored React Router docs — consult before route work
```

Import alias `~/*` → `./app/*` is configured, but existing code mostly uses
relative imports. Match the surrounding file.

## Architecture — the parts that matter

### Data access is server-only

The browser never receives a Supabase key that can read tables. All tables are
RLS **deny-all**; the server connects as the `postgres` role via
`app/lib/server/db.server.ts` (`postgres.js`, `prepare: false` because of the
Supavisor transaction pooler, pool cached on `globalThis` across HMR). Never add
a client-side database call. Never leak the service role key to the client.

### Mutations go through one vocabulary: `SyncOp`

Every write — online or offline — is a `SyncOp` (`app/lib/types.ts`):
`upsert_group`, `delete_group`, `upsert_member`, `delete_member`,
`upsert_entry`, `delete_entry`, `set_category`.

Flow: UI → `submitOp()` (`lib/client/outbox.ts`) → IndexedDB outbox → POST
`/api/sync` → `parseOps()` validation → `applySyncOps()`
(`lib/server/sync.server.ts`) → background doorbell + Gemini categorization.

Rules baked into this design — preserve them:

- Ops are **idempotent upserts** with client-generated UUIDs and
  `clientUpdatedAt`; replaying is a no-op (last-write-wins).
- **Deletes win over concurrent edits** (soft-delete tombstones, `deleted_at`).
- Balances are **never stored** — always recomputed from entries, so sync
  conflicts cannot corrupt them.
- `parse-ops.ts` is the trust boundary for `/api/sync`. Anything new in the
  `SyncOp` union needs validation there *and* a case in
  `lib/client/overlay.ts` (the optimistic client-side mirror of server
  semantics) — the two must not drift.

If you add an op, touch all four: `types.ts`, `parse-ops.ts`,
`sync.server.ts`, `overlay.ts`.

### Offline-first is priority #1

- `loader` hits Postgres; `clientLoader` tries `serverLoader()` first, saves the
  snapshot to IndexedDB, and falls back to the mirror when the network is down.
  A **404 is an answer, not an outage** — it forgets the local copy instead of
  serving a mirror of a deleted group (see `routes/group.tsx`).
- Queued ops are overlaid onto the cached snapshot (`overlayOps`) so unsynced
  changes are visible immediately.
- `routeDiscovery: { mode: "initial" }` in `react-router.config.ts` ships the
  full route manifest upfront — lazy discovery breaks offline navigation. Don't
  change it.
- `public/sw.js` caches the app shell, per-URL navigations and photos; `/api/*`
  is never cached. Bump `VERSION` there when cache semantics change.

### Realtime "doorbell"

After a successful write the server POSTs a **contentless** ping to Supabase
Realtime's REST broadcast endpoint (`lib/server/doorbell.server.ts`); clients
subscribe with the anon key and revalidate. Best-effort by design — failures are
swallowed, clients also revalidate on focus/reconnect. Never put payload data in
a broadcast.

### Background work

`runInBackground()` (`lib/server/background.server.ts`) uses Vercel's
`waitUntil` when available and swallows all errors. Categorization, doorbell
pings, and anything else non-essential run there. **Background work must never
fail a request.**

### Money

Integer cents everywhere. Floats appear only as exchange-rate multipliers, and
every multiplication rounds exactly once (`toBaseCents`). Splits use
largest-remainder distribution (`distributeByWeights`) so shares sum *exactly*
to the amount in all four modes (equal / exact / percent / shares). Exchange
rates are prefilled from `/api/rates` (frankfurter.dev proxy) and **frozen onto
the entry at save time**. Never introduce floating-point arithmetic into the
money path.

### Categorization

1. Keyword matcher (DE+EN, `lib/categories.ts`) runs synchronously at save.
   Matching is on **word boundaries**, never raw substrings — the comment there
   lists the real bugs substring matching caused ("bar" → *Barcelona*).
2. On a miss, async Gemini call through a model fallback chain
   (`modelChain()`), fire-and-forget, never blocks or fails a save.
3. A manual correction is final and writes `category_overrides`, so the same
   title never hits the API again. Both paths that can carry a manual pick funnel
   through `learnCategoryOverride`.

### AI extraction (image / voice / text / clipboard)

`/g/:slug/import` is one screen with four ways in, all landing in the same
review list. All of them funnel through `runExtraction()`
(`lib/server/extract.server.ts`) → `parseExtraction()` (`lib/extract.ts`).

- `prompt.server.ts` holds the shared entry rules for the voice and text paths —
  one copy on purpose, so a misread is fixed once.
- User-supplied text is **quoted inside the prompt**, never concatenated into
  the instructions: pasted "ignore the above" must read as data. Keep it that
  way for any new input path.
- Model output is never trusted. Names are matched against the real member list,
  amounts and dates are re-validated, and **nothing is written until the user
  taps add** — each accepted row becomes an ordinary `upsert_entry` op.
- Requires `GEMINI_API_KEY`; without it the screen says so and manual entry
  still works.

### Security posture

- A group link is a bearer credential: `meta` sets `noindex, nofollow`,
  `vercel.json` sends `X-Robots-Tag` for `/g/*`, and `scrubSlug()` in
  `root.tsx` strips slugs from analytics URLs. Never let a slug reach a third
  party or a log.
- Photos are stored as `bytea` and served through a slug-gated route; only
  jpeg/png/webp are accepted (`PHOTO_TYPES`).

### i18n

DE + EN as typed TypeScript dictionaries — `en.ts` defines `Dictionary`, so a
missing German key is a **type error**. No i18n framework. Detection:
`Accept-Language` server-side, `sumup_locale` cookie wins. All formatting via
`Intl` (`useT()` hands back `t`, `locale`, `intl`). The database stores
locale-free keys. Adding a locale = one file + one entry in `DICTIONARIES`.

Any user-facing string must go into both dictionaries — never hardcode English
in a component.

## Conventions

- **Comments explain *why*, not *what*.** The codebase is dense with short
  rationale comments recording a decision or a bug that motivated the code.
  Match that register: add one when the reason isn't obvious from the code, skip
  it when it is.
- Server-only modules end in `.server.ts` and live in `lib/server/`;
  browser-only modules live in `lib/client/`. Keep domain logic in `lib/*.ts`
  pure so it can be tested and shared by both.
- Routes are registered in `app/routes.ts`; typed route props come from
  `./+types/<route>` (generated by `react-router typegen` — run `npm run
  typecheck` after adding a route).
- Tests are colocated `*.test.ts` next to the module, node environment, pure
  logic only. `vitest.config.ts` deliberately does *not* load the
  `reactRouter()` plugin — no DOM, no DB, no network in tests. Domain logic
  (money, split, balances, categories, duplicates, extract, parse-ops,
  clipboard) is covered; add tests there when you touch it.
- Graceful degradation is a rule, not a preference: missing Gemini key, missing
  Supabase config, failed rate fetch, offline network — each has a defined
  fallback. Preserve it in new code.
- Commit messages are conventional-ish and lowercase (`feat:`, `fix:`), phrased
  as what the user gets.
