# Sum Up — Plan

A Splid-style group expense splitter. No accounts — a group's unguessable link is the credential.
Agreed in a grilling session on 2026-07-18; this file is the spec of record.

## Product decisions

### Model & access
- **Splid clone, not Splitwise**: no user accounts. Anyone with a group's link/invite code has full access.
- **Device-local member claim**: on first open, the app asks "Which member are you?" and stores the
  answer in a cookie. Used for personalized "your balance" and default payer. Unenforced UX sugar.
- **All data flows through React Router loaders/actions.** The browser never gets a Supabase key that
  can read tables. Tables are RLS deny-all; the server talks to Postgres directly.

### Ledger
- **Multi-currency**: one base currency per group (chosen at creation). Expenses can be in any
  ECB-covered currency. Exchange rate pre-filled from frankfurter.dev, editable, **frozen onto the
  expense at save time**. If the fetch fails, the user types a rate manually.
- **Split modes**: equal, exact amounts, percentages, shares. All amounts are integer cents.
  Largest-remainder rounding — every split sums exactly to the expense amount, no floating point in
  the money path.
- **Payment entries** ("Anna paid Ben €20") shift balances toward zero.
- **Settle-up suggestions**: greedy max-debtor→max-creditor matching (≤ n−1 transfers), triangular
  shortcuts allowed, displayed in base currency, one tap records a suggestion as a payment.
- **Mutation rules**: anyone edits/deletes anything; hard delete from the UX perspective
  (soft-delete tombstones internally for offline sync); members deletable only when referenced by
  zero entries; groups deletable with confirmation, cascading.

### Features
- Editable expense date (default today), optional note.
- **Receipt photos**: stored in Postgres (bytea), client-side resize before upload, served via a
  slug-gated route. Free tier only, no Supabase Storage subscription.
- **Capture expenses** (`/g/:slug/import`): one screen with four ways in — write or paste text,
  paste an image straight from the clipboard, record a voice message, or pick an image file — all
  landing in the same review list before anything is written.
- **Text and clipboard**: a box takes typed or pasted text (a chat message, a line copied out of a
  banking app, a note) and reads it with the same rules as the voice path — the text is quoted
  inside the prompt, so a pasted "ignore the above" is data and not an order. A "paste" button
  reads the clipboard and, if it holds an image, resizes and sends it in one tap with no second
  confirmation; ⌘V / Strg+V anywhere on the screen does the same, and inside the box it stays an
  ordinary paste. Browsers that refuse clipboard reads say so and point at ⌘V.
- **Voice message**: recorded in the browser (`MediaRecorder`, capped at 90 s), decoded and
  re-encoded client-side as 16 kHz mono WAV so every browser's container becomes one format the
  model accepts and the upload stays small. Gemini transcribes and extracts in one call: one
  message can describe several purchases and they come back as separate rows, and spoken people
  ("Ben hat bezahlt", "nur für Anna und mich") are matched against the real member list to prefill
  payer and participants — short forms count ("Fabi" for Fabian) as long as they stay unique, and
  an ambiguous or half-understood name falls back to the defaults instead of guessing who owes
  money. A repayment („zwei Euro von Leo an Fabi") is recognized as a payment entry rather than an
  expense: payer, recipient, no split and no category, so it settles a debt instead of creating one
  and stays out of the spending stats. Every row can be switched between expense and payment while
  reviewing. The transcript is shown next to the rows so a misread amount is
  explainable, and the recording itself is never stored.
- **Import from image** (`/g/:slug/import`): a screenshot of a banking app's transaction list
  or a photo of a receipt goes to Gemini vision (same model fallback chain, structured JSON
  response); everything found lands in a review screen — original on the left, extracted
  expenses on the right (stacked on mobile) — with per-row compact controls for payer,
  participants, date, category, amount and currency. Defaults: the importer paid, split equally
  between everyone; dates resolved to absolute dates; the amount is the one in the account's own
  currency (a foreign currency gets the usual `/api/rates` prefill). Nothing is written until
  "add"; then each row becomes an ordinary `upsert_entry` op through the outbox. A single-expense
  image is kept as that expense's receipt photo, a multi-expense screenshot is not.
  Requires `GEMINI_API_KEY`; without it the screen says so and the manual form still works.
- **Duplicate warnings** (`app/lib/duplicates.ts`): before an expense is added it is scored against
  the ones already in the group — the base-currency amount is the anchor (≤ 0.5 % apart, to absorb
  two different exchange rates), sharpened by date distance (≤ 14 days) and title similarity (Dice
  over character bigrams, accent- and punctuation-insensitive). Above a threshold the entry form
  shows a panel naming the matching entries, and each row of the image import gets an inline hint
  plus a "deselect them" shortcut in a summary banner. Purely advisory: nothing is blocked and
  nothing is deselected without a tap.
- **CSV export** of all entries; **per-member stats** (who spent/owes what).
- **Auto-categorization** (categories: food, groceries, transport, accommodation, activities,
  shopping, other):
  1. Keyword matcher (DE+EN) runs synchronously at save — expense stores immediately.
  2. On a miss, async Gemini call: `gemini-2.5-flash-lite` → `gemini-2.5-flash` → `gemini-2.5-pro`
     fallback chain (verify current IDs at build time), short timeout, never blocks or fails a save.
  3. Manual correction is final and teaches the group's learned keyword table
     (`category_overrides`), so the same title never hits the API again.
  - Requires `GEMINI_API_KEY`; without it, keyword-only (graceful).

### Client
- **Offline-first is priority #1** (ranked above realtime by the user):
  - IndexedDB mirror of group data; `clientLoader` = network-first, IDB fallback.
  - Persistent outbox: mutations are idempotent upserts with client-generated UUIDs and
    `client_updated_at`; replayed against the same server actions on reconnect.
  - Conflicts: last-write-wins per entry; deletes win over edits. Balances are recomputed from
    entries so they cannot conflict.
  - App-shell service worker (cache-first hashed assets, offline navigation fallback), installable
    PWA (manifest + icons). Pending photo uploads/categorization shown honestly as pending.
- **Realtime doorbell** (kept because it's cheap, not because it rivals offline): Supabase Realtime
  broadcast channel named after the group slug, used purely as a "changed" ping → revalidate.
  Anon key in the browser can read no tables.
- **i18n**: DE + EN as typed TypeScript dictionaries (missing key = type error), no i18n framework,
  designed so adding locale #3 = one file + one union member. Detection: `Accept-Language`
  server-side, cookie switcher wins. Formatting via `Intl` only. DB stores locale-free keys.
- **Design**: iOS-26 "liquid glass", mobile-first — translucent blurred panels over a fixed page
  gradient, Plus Jakarta Sans for the interface and Space Grotesk for every figure. One design in
  two grounds: dark is the drawn direction, light is the same material inverted, and every
  component reads from the same tokens rather than branching on theme. Big touch targets; the
  group screen leads with "your balance". **Per-group accent color** from ~10 curated swatches,
  each carrying two tones — a deep one for the pale ground, the iOS system tone for the dark one —
  random on creation, editable in group settings, applied via CSS variables. Label colour on a
  filled accent is computed per swatch, so a lime button isn't white-on-white.
  Display name "Sum Up" (no relation to the fintech).
- **Group navigation**: a floating glass capsule with four tabs — Overview, Activity, Stats,
  Settings — and a thumb that slides between them. Overview answers "where do I stand"; the entry
  history lives in Activity, so neither screen scrolls past its own answer.
- **Overlays are route-backed**. Adding an expense or a payment, capturing with AI, creating a
  group and editing an entry are drawn as bottom sheets and pushed-in detail panels, but each is
  still a real route with a real URL — that is what keeps the back button, deep links and the
  service worker's per-URL page cache working. `components/overlays.tsx` supplies the enter
  animation and, because a route unmounts the instant you navigate, an explicit exit animation
  that finishes *before* the navigation is issued. Picking who you are is the one exception: it is
  device-local, has no meaningful URL, and so is a state-driven sheet.
- **The amount is entered on an on-screen pad**, with the display kept as a real input at
  `inputMode="none"` — that suppresses the system keyboard while keeping the caret, physical
  keyboards, screen readers and iOS's long-press Paste callout. An explicit Paste button covers
  the browsers that hide the callout.
- **No nested `backdrop-filter`**: a blur inside a fixed, scrolling ancestor that also composites
  leaves blank tiles in Chrome. Glass inside a sheet or push panel is a flat translucent fill;
  nothing is lost, because those panels are near-opaque and have no page behind them to blur.

## Technical design

- **Stack**: React Router 8 (framework mode, SSR), Tailwind 4, TypeScript, Vite.
- **DB access**: `postgres` (postgres.js) over the Supavisor transaction pooler (`prepare: false`).
  The `postgres` role owns the tables → bypasses RLS; anon/authenticated have no policies.
- **Schema** (all PKs client-generatable UUIDs; `updated_at` for LWW; `deleted_at` tombstones):
  - `groups(id, slug unique, name, base_currency, accent_color, updated_at, deleted_at)`
  - `members(id, group_id, name, updated_at, deleted_at)`
  - `entries(id, group_id, kind expense|payment, title, note, category, category_source,
    payer_id, recipient_id, amount_cents, currency, exchange_rate numeric, split_mode,
    expense_date, photo_id, updated_at, deleted_at)`
  - `entry_shares(entry_id, member_id, share_cents, input_value)` — computed, exact-summing
  - `category_overrides(group_id, title_normalized, category)` — learned table
  - `photos(id, group_id, data bytea, content_type, updated_at)`
- **Doorbell**: server POSTs to Realtime's REST broadcast endpoint after successful writes
  (serverless-friendly, no WebSocket from the server); clients subscribe with the publishable key.
- **Rates**: `/api/rates` proxy to `api.frankfurter.dev` (≈30 ECB currencies).
- **Categorization**: fire-and-forget after the response (detached promise on the long-lived
  Node process), row update + doorbell.
- **Security headers**: set by a root `middleware` in `root.tsx`, not by host config —
  `Referrer-Policy: no-referrer`, `nosniff`, `X-Frame-Options: DENY` everywhere, plus
  `X-Robots-Tag: noindex, nofollow` on `/g/*`.
- **Analytics**: self-hosted Umami on `analytics.leonardsima.de`; every URL passes through
  `scrubUrl()` so the group slug never leaves the device. No personal data in events.
- **Env**: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GEMINI_API_KEY` (user-supplied).
- **Hosting**: self-hosted. The container is built from `Dockerfile` (`npm run start` →
  `react-router-serve`) and served behind Cloudflare at https://sum-up.leonardsima.de.
  **No Vercel** — see the note in `CLAUDE.md` about the dead config that migration left
  behind. Nothing platform-specific belongs in this repo.
- **Database**: Postgres. When the connection string points at Supabase's Supavisor
  transaction pooler (`postgres.<ref>@aws-0-eu-central-1.pooler.supabase.com:6543`),
  `prepare: false` in `db.server.ts` is mandatory — the pooler does not support prepared
  statements. That flag is harmless against a plain Postgres, so it stays either way.
  The Supabase project (`sum-up`, `eu-central-1`, free tier) also provides the Realtime
  broadcast used by the doorbell; both are optional and the app degrades without them.

## Route map

- `/` — device-known groups with your balance in each (works offline), join by code/link.
  A layout route, not an index: `/new` is a sheet over it and needs its host mounted.
- `/new` — create group (name, base currency, members) — sheet
- `/g/:slug` — Overview tab: your balance, all balances, settle/payment
- `/g/:slug/activity` — Activity tab: entries by day with daily totals
- `/g/:slug/stats` — Stats tab: per-member and per-category totals; every row unfolds
  into the expenses behind it
- `/g/:slug/settings` — Settings tab: rename, accent color, members, language, CSV export, delete
- `/g/:slug/new-expense`, `/g/:slug/new-payment`, `/g/:slug/import` — sheets
- `/g/:slug/entry/:id` (edit), `/g/:slug/settle` — push panels
- `/legal` — imprint and privacy notice, linked from the start screen footer
- `/g/:slug/export.csv`, `/g/:slug/photo/:photoId`, `/api/rates`
