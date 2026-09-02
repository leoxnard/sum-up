# Sum Up

A Splid-style group expense splitter. No accounts — a group's unguessable link is the credential.
Offline-first PWA, multi-currency, auto-categorization. See [PLAN.md](PLAN.md) for the full spec
and architecture decisions.

## Stack

- React Router 8 (framework mode, SSR) + Tailwind 4 + TypeScript
- Postgres (Supabase in production, Docker locally) via `postgres.js` — server-only, RLS deny-all
- Supabase Realtime broadcast as a "doorbell" (contentless change pings)
- IndexedDB mirror + outbox for offline reads/writes, service worker for the app shell
- frankfurter.dev for ECB exchange rates, Gemini for expense auto-categorization (optional)
- Self-hosted Umami for analytics — group slugs are scrubbed before any URL is reported

## Development

```bash
# 1. Local Postgres + schema
docker run -d --name sumup-pg -e POSTGRES_PASSWORD=sumup_dev -e POSTGRES_DB=sumup \
  -p 55432:5432 postgres:17-alpine
docker exec -i sumup-pg psql -U postgres -d sumup < supabase/migration/0001_init.sql

# 2. Env (see .env) — DATABASE_URL is the only required var
# 3. Run
npm install
npm run dev
```

Optional env vars: `SUPABASE_URL` + `SUPABASE_ANON_KEY` (realtime doorbell),
`GEMINI_API_KEY` (+ `GEMINI_MODELS` override) for LLM categorization of titles the
keyword matcher misses. Everything degrades gracefully without them.

## Production

Self-hosted at <https://sum-up.leonardsima.de> — a Docker container behind Cloudflare.

- Apply `supabase/migration/0001_init.sql` to the production database.
- Build and run the image from `Dockerfile`; it serves on port 3000
  (`react-router-serve`).
- Set `DATABASE_URL` (required) and, if you want them, `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `GEMINI_API_KEY`.

Security headers (`Referrer-Policy`, `nosniff`, `X-Frame-Options`, and
`X-Robots-Tag` on `/g/*`) are sent by the app itself, from a root middleware in
`app/root.tsx` — not by any host configuration. Deliberately: the same headers
once lived in a `vercel.json` and disappeared unnoticed when the host changed.

## Icons

`node scripts/gen-icons.mjs` regenerates the PWA PNGs from the design in the script.
