# BranchFlow

Intelligent Branch Service Load & Customer Experience Optimizer (hackathon demo for the TCS problem statement).
`CLAUDE.md` is the build spec.

**Stack:** Next.js 14 (App Router, TypeScript) · Tailwind + shadcn/ui · lucide-react · Recharts · Supabase (Postgres + Realtime) · Anthropic API (with rule-based fallbacks) · Vitest.

## Setup

```bash
npm install
cp .env.local.example .env.local      # then fill in the values
npm run db:migrate                    # creates the schema (supabase/migrations/*.sql)
npm run db:seed                       # generates synthetic data -> /data/*.csv and seeds the DB
npm run dev                           # http://localhost:3000
```

### Where the env values come from (Supabase dashboard)

| Variable | Location |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API (server-only, never expose to the browser) |
| `DATABASE_URL` | Connect → Connection string → **Session pooler** (port 5432). URL-encode special characters in the password. |
| `ANTHROPIC_API_KEY` | Optional. Without it, every AI feature falls back to rules. |

No `DATABASE_URL`? You can paste `supabase/migrations/0001_init.sql` into the Supabase **SQL Editor** instead of
running `db:migrate`. The seed still needs `DATABASE_URL`.

### Scripts

| Command | What it does |
|---|---|
| `npm run db:migrate` | Applies pending migrations, tracked in `schema_migrations`. Add `-- --force` to re-run them all (they are idempotent). |
| `npm run db:seed` | Regenerates the data and **truncates + reseeds** every table in a single transaction. |
| `npm run db:generate` | Writes the CSVs only, without touching the DB. |
| `npm test` | Vitest unit tests (engine, calendar, catalog, replay). |
| `npm run typecheck` / `npm run lint` / `npm run build` | Checks. |

Generator flags (`npx tsx scripts/generate.ts ...`): `--no-db`, `--seed 42`, `--days 90`,
`--end YYYY-MM-DD` (last history day, defaults to yesterday IST), `--future 7` (days of rosters from today).

Check the app can reach the DB: `GET /api/health`.

## Demo logins (role picker at `/`)

No real auth. Staff and managers sign in with a 4-digit demo PIN, and the picker shows it as a hint.

| Branch | Profile | Manager PIN | Staff PINs |
|---|---|---|---|
| BR01 MG Road | Urban business (lunch peak) | 1100 | 1101–1107 |
| BR02 Whitefield | Residential (morning + evening) | 2200 | 2201–2206 |
| BR03 Hoskote | Semi-urban (Wednesday market day) | 3300 | 3301–3305 |
| BR04 Jayanagar | Senior-heavy (pension days) | 4400 | 4401–4406 |
| BR05 Malleshwaram | College area (Quick-heavy, start of month) | 5500 | 5501–5505 |

Staff PIN `<b><b>0<n>` belongs to counter `n` (e.g. 1104 = Anita Desai, counter 4, BR01).

## Project layout

```
app/                      routes (role picker + a placeholder page for every route in CLAUDE.md section 2)
components/ui/            shadcn/ui components
lib/types.ts              domain types (mirror the SQL schema)
lib/data/catalog.ts       service catalog: documents, digital steps, keywords (AI knowledge base)
lib/data/branches.ts      5 branches, staff, counters (static so PINs are stable)
lib/data/profiles.ts      demand profiles per branch (ground truth for the generator)
lib/data/holidays.ts      demo bank-holiday calendar
lib/engine/calendar.ts    working days + explainable day factors (section 9.1)
lib/engine/scoring.ts     pull-based token scoring (section 7.1)
lib/random.ts             seeded RNG, Poisson, lognormal
lib/supabase/             browser (anon) and server (service role) clients
scripts/generate.ts       synthetic data generator
scripts/lib/replay.ts     replays each historical day through the queue scoring
scripts/migrate.ts        migration runner
supabase/migrations/      SQL schema
data/                     generated CSVs
```

## Data Considerations

- **All data is synthetic.** Branches, staff names and visits are generated. "Sample Demo Bank" procedures are
  illustrative only and are not any real bank's process.
- **No sensitive identifiers.** The schema has no columns for account numbers, Aadhaar, PAN or card numbers.
  Mobile numbers are stored masked (`98xxxxxx21`). Historical visits hold no customer names or phones.
- **How the history is built** (90 days, 5 branches, about 51k visits and 14k feedback rows with the default seed):
  - Arrivals are Poisson per hour per category: `daily volume × hour curve × category mix × day-of-week ×`
    the section 9.1 factors (salary day 1.4, month end 1.2, post-holiday 1.3, pension day 1.3 for Standard at the
    senior-heavy branch). The college branch adds a start-of-month boost on Quick services; the semi-urban
    branch has a Wednesday market day.
  - Banks are closed on Sundays, 2nd/4th Saturdays and demo holidays.
  - Staff rosters include about 8% random absences, staggered lunch breaks (6% overrun) and short breaks.
  - Handle times are lognormal around each service's average, scaled per branch (seniors take longer) and per
    staff member.
  - **Waits come from replaying each day through the same scoring function the live engine uses**, so history and
    live behaviour are consistent. The replay also models appointments, priority customers, no-shows, customers
    giving up after long waits, and misrouting transfers (e.g. KYC → address update).
  - About 30% of completed visits leave feedback. Ratings correlate with wait vs target, transfers and outcome.
    Comments are templated, in English and some Hinglish, and carry ground-truth topic tags.
- **Deterministic.** The same `--seed` and `--end` always produce the same data.
