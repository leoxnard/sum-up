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
- **Capture expenses** (`/g/:slug/import`): one screen with two ways in — record a voice message
  or pick an image — both landing in the same review list before anything is written.
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
- **Design**: clean-minimal, mobile-first, system dark mode, big touch targets, group screen leads
  with "your balance", thumb-reachable "+". **Per-group accent color** from ~10 curated swatches
  (contrast-safe in both modes), random on creation, editable in group settings, applied via CSS
  variable. Display name "Sum Up" (no relation to the fintech).

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
- **Categorization**: fire-and-forget after response (`waitUntil` on Vercel), row update + doorbell.
- **Env**: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GEMINI_API_KEY` (user-supplied).
- **Infra**: Supabase project `sum-up`, `eu-central-1` (Frankfurt), $0/month confirmed
  (created under a second Supabase account, since the original account's free-tier 2-project
  cap was already used by GeoBingoDB + spielzettel). **Use the Supavisor transaction pooler**
  connection string (`postgres.<ref>@aws-0-eu-central-1.pooler.supabase.com:6543`) for
  `DATABASE_URL`, not the direct `db.<ref>.supabase.co:5432` host — Vercel's serverless network
  cannot resolve the direct hostname (`ENOTFOUND`), pooler works. Deployed to Vercel at
  https://sum-up-delta.vercel.app, functions pinned to `fra1` via `vercel.json`.

## Route map

- `/` — device-known groups (works offline), create group, join by code/link
- `/new` — create group (name, base currency, members)
- `/g/:slug` — group overview: your balance, all balances, entry list, "+"
- `/g/:slug/new-expense`, `/g/:slug/new-payment`, `/g/:slug/entry/:id` (edit)
- `/g/:slug/settle` — settlement suggestions, one-tap record
- `/g/:slug/stats` — per-member and per-category totals
- `/g/:slug/settings` — rename, accent color, members, language, CSV export, delete
- `/g/:slug/export.csv`, `/g/:slug/photo/:photoId`, `/api/rates`
