-- BranchFlow schema (CLAUDE.md section 3)
-- Idempotent: safe to re-run. Run with `npm run db:migrate` or paste into the Supabase SQL editor.
-- Privacy: no account numbers / Aadhaar / PAN are ever stored. Mobiles are stored masked (98xxxxxx21).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

create table if not exists branches (
  id          text primary key,                         -- e.g. BR01
  name        text not null,
  area_type   text not null check (area_type in ('URBAN_BUSINESS','RESIDENTIAL','SEMI_URBAN','SENIOR_HEAVY','COLLEGE_AREA')),
  address     text,
  lat         double precision not null,
  lng         double precision not null,
  open_time   time not null default '10:00',
  close_time  time not null default '16:00'
);

create table if not exists services (
  id                text primary key,                   -- e.g. cash_deposit (LLM returns this id)
  name              text not null,
  name_hi           text,
  category          text not null check (category in ('QUICK','STANDARD','COMPLEX')),
  skill             text not null check (skill in ('QUICK','STANDARD','COMPLEX','LOANS')),
  avg_handle_min    numeric(6,2) not null,              -- catalog value; engine learns per-branch rolling mean
  target_wait_min   integer not null,
  digital_possible  boolean not null default false,
  digital_level     text not null default 'NONE' check (digital_level in ('FULL','PARTIAL','NONE')),
  digital_minutes   integer,                            -- "Save a trip — do it in ~X min"
  digital_channel   text,                               -- e.g. "Mobile app", "ATM", "Video KYC"
  digital_link      text,
  digital_steps     jsonb not null default '[]'::jsonb, -- ["Open app", "Tap Services", ...]
  documents         jsonb not null default '[]'::jsonb, -- [{id,label,note,required}]
  keywords          text[] not null default '{}',
  icon              text,                               -- lucide-react icon name for kiosk tiles
  sort_order        integer not null default 0
);

create table if not exists holidays (
  date  date primary key,
  name  text not null
);

create table if not exists staff (
  id             text primary key,                      -- e.g. BR01-S1, BR01-M
  branch_id      text not null references branches(id) on delete cascade,
  name           text not null,
  pin            text not null,                         -- demo only, 4 digits
  role           text not null default 'STAFF' check (role in ('STAFF','MANAGER')),
  skills         text[] not null,
  primary_skill  text not null check (primary_skill in ('QUICK','STANDARD','COMPLEX','LOANS'))
);
create index if not exists staff_branch_idx on staff(branch_id);

-- Addition: daily roster (needed for Erlang "rostered vs needed" and ~8% absences in synthetic data)
create table if not exists rosters (
  id           bigserial primary key,
  branch_id    text not null references branches(id) on delete cascade,
  staff_id     text not null references staff(id) on delete cascade,
  date         date not null,
  shift_start  time not null,
  shift_end    time not null,
  absent       boolean not null default false,
  breaks       jsonb not null default '[]'::jsonb,       -- [{start:"13:10", minutes:30, reason:"lunch"}]
  unique (staff_id, date)
);
create index if not exists rosters_branch_date_idx on rosters(branch_id, date);

create table if not exists counters (
  id                  text primary key,                 -- e.g. BR01-C1
  branch_id           text not null references branches(id) on delete cascade,
  number              integer not null,
  staff_id            text references staff(id) on delete set null,
  status              text not null default 'OFFLINE' check (status in ('OFFLINE','AVAILABLE','SERVING','ON_BREAK')),
  mode_skill          text check (mode_skill in ('QUICK','STANDARD','COMPLEX','LOANS')),
  status_since        timestamptz not null default now(),
  break_expected_end  timestamptz,
  break_reason        text,
  human_control       boolean not null default false,   -- simulator: a teammate drives this counter live
  unique (branch_id, number)
);

-- ---------------------------------------------------------------------------
-- Live queue
-- ---------------------------------------------------------------------------

create table if not exists tokens (
  id                  uuid primary key default gen_random_uuid(),
  branch_id           text not null references branches(id) on delete cascade,
  code                text not null,                    -- Q### / S### / C### / A###
  service_id          text not null references services(id),
  customer_name       text,
  mobile_masked       text,
  language            text not null default 'en' check (language in ('en','hi')),
  source              text not null check (source in ('APP_APPOINTMENT','APP_WALKIN','KIOSK','GREETER','STAFF')),
  priority_flag       text not null default 'NONE' check (priority_flag in ('NONE','SENIOR','DISABLED','PREGNANT')),
  status              text not null check (status in ('BOOKED','WAITING','CALLED','SERVING','PARKED','COMPLETED','TRANSFERRED','NO_SHOW','CANCELLED')),
  created_at          timestamptz not null default now(),
  appointment_start   timestamptz,
  appointment_end     timestamptz,
  checked_in_at       timestamptz,
  called_at           timestamptz,
  serving_started_at  timestamptz,
  completed_at        timestamptz,
  counter_id          text references counters(id) on delete set null,
  recall_count        integer not null default 0,
  skip_count          integer not null default 0,       -- "Not here" presses; 2nd => NO_SHOW
  parked_until        timestamptz,
  original_arrival_at timestamptz not null default now(),
  returning_boost     boolean not null default false,   -- +20 after PARKED / TRANSFERRED
  parent_token_id     uuid references tokens(id) on delete set null,  -- "Add another service" / transfer chain
  ai_summary          jsonb,                            -- {summary, extra_notes, confidence, documents_checked[]}
  outcome             text check (outcome in ('RESOLVED','PARTIALLY_RESOLVED','NEEDS_FOLLOW_UP')),
  could_be_digital    boolean,
  eta_minutes         integer,
  position            integer
);
create index if not exists tokens_branch_status_idx on tokens(branch_id, status);
create index if not exists tokens_branch_created_idx on tokens(branch_id, created_at);
create index if not exists tokens_appt_idx on tokens(branch_id, appointment_start) where appointment_start is not null;

create table if not exists token_events (             -- audit log, feeds analytics
  id           bigserial primary key,
  token_id     uuid not null references tokens(id) on delete cascade,
  type         text not null,                           -- CREATED, CHECK_IN, CALL, RECALL, START, SKIP, COMPLETE, TRANSFER, PARK, RETURN, CANCEL, NO_SHOW, NOTE, ...
  from_status  text,
  to_status    text,
  counter_id   text references counters(id) on delete set null,
  staff_id     text references staff(id) on delete set null,
  note         text,
  meta         jsonb,
  at           timestamptz not null default now()
);
create index if not exists token_events_token_idx on token_events(token_id);
create index if not exists token_events_at_idx on token_events(at);

create table if not exists counter_events (
  id          bigserial primary key,
  counter_id  text not null references counters(id) on delete cascade,
  staff_id    text references staff(id) on delete set null,
  type        text not null,                            -- ONLINE, OFFLINE, BREAK_START, BREAK_END, MODE_CHANGE, OUTAGE
  reason      text,
  meta        jsonb,
  at          timestamptz not null default now()
);
create index if not exists counter_events_counter_idx on counter_events(counter_id, at);

-- ---------------------------------------------------------------------------
-- Feedback, forecasting, alerts, recommendations
-- ---------------------------------------------------------------------------

-- 90 days of synthetic historical visits for forecasting (one row per customer visit)
create table if not exists visit_history (
  id                   bigserial primary key,
  branch_id            text not null references branches(id) on delete cascade,
  date                 date not null,
  day_of_week          smallint not null,               -- 0=Sun .. 6=Sat
  hour                 smallint not null,               -- arrival hour (local)
  arrival_at           timestamptz not null,
  service_id           text not null references services(id),
  final_service_id     text not null references services(id),   -- differs if transferred
  category             text not null,
  skill                text not null,
  source               text not null,
  priority_flag        text not null default 'NONE',
  appointment_start    timestamptz,
  called_at            timestamptz,
  serving_started_at   timestamptz,
  completed_at         timestamptz,
  wait_min             numeric(7,2),                    -- total minutes waiting (all legs)
  handle_min           numeric(7,2),                    -- total minutes at counter (all legs)
  status               text not null check (status in ('COMPLETED','NO_SHOW','CANCELLED')),  -- CANCELLED = left without service
  outcome              text check (outcome in ('RESOLVED','PARTIALLY_RESOLVED','NEEDS_FOLLOW_UP')),
  transfer_count       smallint not null default 0,
  could_be_digital     boolean not null default false,
  counter_number       smallint,
  staff_id             text references staff(id) on delete set null,
  sla_met              boolean
);
create index if not exists visit_history_branch_date_idx on visit_history(branch_id, date);
create index if not exists visit_history_forecast_idx on visit_history(branch_id, day_of_week, hour, category);
create index if not exists visit_history_service_idx on visit_history(branch_id, final_service_id, completed_at);

create table if not exists feedback (
  id         uuid primary key default gen_random_uuid(),
  token_id   uuid references tokens(id) on delete set null,
  visit_id   bigint references visit_history(id) on delete cascade,  -- historical feedback
  branch_id  text not null references branches(id) on delete cascade,
  rating     smallint not null check (rating between 1 and 5),
  comment    text,
  sentiment  text check (sentiment in ('pos','neu','neg')),
  topics     text[] not null default '{}',
  at         timestamptz not null default now()
);
create index if not exists feedback_branch_at_idx on feedback(branch_id, at);

create table if not exists forecasts (
  branch_id          text not null references branches(id) on delete cascade,
  date               date not null,
  hour               smallint not null,
  category           text not null check (category in ('QUICK','STANDARD','COMPLEX')),
  expected_arrivals  numeric(8,2) not null,
  explanation        jsonb not null default '{}'::jsonb,  -- {base, factors:[{name,value}], booked}
  primary key (branch_id, date, hour, category)
);

create table if not exists recommendations (
  id           uuid primary key default gen_random_uuid(),
  branch_id    text not null references branches(id) on delete cascade,
  type         text not null check (type in ('SWITCH_FOCUS','OPEN_COUNTER','DIGITAL_NUDGE','TIME_SHIFT_APPOINTMENTS','BRANCH_REDIRECT','STAFF_LENDING')),
  title        text not null,
  explanation  text not null,
  impact       jsonb not null default '{}'::jsonb,        -- from what-if ETA projection, never LLM-guessed
  action       jsonb not null default '{}'::jsonb,        -- executable payload
  status       text not null default 'OPEN' check (status in ('OPEN','ACCEPTED','DISMISSED')),
  at           timestamptz not null default now(),
  resolved_at  timestamptz
);
create index if not exists recommendations_branch_status_idx on recommendations(branch_id, status);

create table if not exists alerts (
  id                   uuid primary key default gen_random_uuid(),
  branch_id            text not null references branches(id) on delete cascade,
  type                 text not null,                   -- QUEUE_OVERLOAD, STUCK_COUNTER, LONG_BREAK, FORECAST_GAP, NO_SHOW_SPIKE, MISROUTING, LOW_CSAT, ESCALATION
  severity             text not null default 'WARN' check (severity in ('INFO','WARN','CRITICAL')),
  title                text not null,
  why                  text not null,                   -- plain English with numbers
  suggested_action_id  uuid references recommendations(id) on delete set null,
  status               text not null default 'OPEN' check (status in ('OPEN','ACKNOWLEDGED','RESOLVED')),
  dedupe_key           text,                            -- engine tick upserts instead of spamming
  at                   timestamptz not null default now()
);
create index if not exists alerts_branch_status_idx on alerts(branch_id, status);

create table if not exists sms_outbox (                -- mocked SMS, rendered in on-screen "phone"
  id             bigserial primary key,
  mobile_masked  text not null,
  token_id       uuid references tokens(id) on delete set null,
  body           text not null,
  at             timestamptz not null default now()
);
create index if not exists sms_outbox_token_idx on sms_outbox(token_id);

-- Addition: product analytics events (digital_deflection clicks, redirects shown, etc.)
create table if not exists app_events (
  id          bigserial primary key,
  branch_id   text references branches(id) on delete set null,
  type        text not null,                            -- digital_deflection, redirect_shown, ...
  service_id  text references services(id),
  token_id    uuid references tokens(id) on delete set null,
  meta        jsonb,
  at          timestamptz not null default now()
);
create index if not exists app_events_type_at_idx on app_events(type, at);

-- Addition: branch-level live settings (redirect banner from recommendation type 5)
create table if not exists branch_settings (
  branch_id          text primary key references branches(id) on delete cascade,
  redirect_to        text references branches(id),
  redirect_message   text,
  updated_at         timestamptz not null default now()
);

-- Addition: live simulator clock (single row). Simulated "today" starts 10:00.
create table if not exists sim_state (
  id          smallint primary key default 1 check (id = 1),
  sim_now     timestamptz not null,
  speed       integer not null default 0,              -- 0 = paused, 1, 10, 30, 60
  running     boolean not null default false,
  mode        text not null default 'BRANCHFLOW' check (mode in ('BRANCHFLOW','FIFO')),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Access (hackathon: no real auth; RLS left off) + Realtime
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant usage on schema public to anon, authenticated, service_role;
    grant all on all tables in schema public to anon, authenticated, service_role;
    grant all on all sequences in schema public to anon, authenticated, service_role;
  end if;
end $$;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['tokens','counters','token_events','alerts','recommendations','sms_outbox','sim_state','branch_settings','feedback']
    loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
