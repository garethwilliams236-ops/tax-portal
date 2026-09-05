# Tax Portal

Multi-entity UK tax management — Corporation Tax, VAT, PAYE/NIC across the companies,
Self Assessment for the individuals, with the return-first ledger and the Ivor assistant.

Same stack as the Ardent CRM: Next.js (App Router) · TypeScript · Supabase · Tailwind · Vercel.

## Why the data is not in your browser

Every page is a server component. Rows are fetched on the server, rendered to HTML and
forgotten. The only thing the browser holds is the Supabase session cookie, which is
`httpOnly` — JavaScript cannot read it, and neither can anything that gets at the browser
profile. There is no `localStorage`, no `sessionStorage`, no IndexedDB. Lose the laptop and
you lose nothing but the laptop.

Row-level security is the access control, not a `WHERE` clause. The service-role key is
never used on a request path and is never exposed to the client.

## Layout

```
web/
  app/
    (app)/            authenticated pages — overview, per-entity
    login/            magic-link sign-in
    auth/             callback and sign-out
  lib/
    tax/              pure functions, fully unit tested — no I/O
    db/               typed reads, RLS-enforced
    supabase/         server / browser / middleware clients
  middleware.ts       refreshes the session, bounces anonymous traffic
supabase/migrations/  schema, RLS, ledger, bootstrap
```

`lib/tax/` is the part that matters and the part that is tested: 129 tests covering
marginal relief, association, the NIC thresholds, payments on account, quarterly instalment
dates, allocation and the ledger arithmetic.

## Setup

1. **Create a Supabase project.** Note the project ref.
2. **Run the migrations** in order, in the SQL editor or via the CLI:
   ```
   supabase link --project-ref YOUR_REF
   supabase db push
   ```
   Or paste `supabase/migrations/*.sql` in order into the SQL editor.
3. **Configure auth.** Authentication → URL Configuration → add
   `http://localhost:3000/auth/callback` and your Vercel URL's callback as redirect URLs.
4. **Environment.** `cp web/.env.example web/.env.local` and fill it in.
5. **Run it.**
   ```
   cd web
   source scripts/load-env.sh
   npm install
   npm run dev
   ```
6. **Sign in once.** The first account through the door becomes the owner and is granted
   access to every entity. Everything created afterwards is owned by its creator.

## Before committing

```
npm run typecheck
npm test
```

## Deploy

Vercel, root directory `web`. Set the same four environment variables in the project
settings. `NEXT_PUBLIC_SITE_URL` must be the production URL or magic links will come back
to localhost.
