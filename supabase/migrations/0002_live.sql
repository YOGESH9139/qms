-- Live demo additions: mobile lookup hash, simulator state, aggregate views for forecasting/insights.

alter table tokens add column if not exists mobile_hash text;          -- sha256 of mobile, for kiosk check-in lookup
create index if not exists tokens_mobile_hash_idx on tokens(mobile_hash) where mobile_hash is not null;

alter table sim_state add column if not exists branch_id text references branches(id);
alter table sim_state add column if not exists last_tick timestamptz;  -- sim time processed up to
alter table sim_state add column if not exists scenario jsonb not null default '{}'::jsonb;

-- Hourly arrivals per category (forecast base rates + MAPE)
create or replace view visit_hourly as
  select branch_id, date, day_of_week, hour, category, count(*)::int as arrivals
  from visit_history
  group by branch_id, date, day_of_week, hour, category;

-- Daily KPIs per branch (insights trends)
create or replace view visit_daily as
  select branch_id, date,
         count(*)::int as visits,
         round(avg(wait_min) filter (where status = 'COMPLETED'), 1) as avg_wait,
         round(100.0 * avg(case when sla_met then 1 else 0 end) filter (where status = 'COMPLETED'), 1) as sla_pct,
         count(*) filter (where could_be_digital)::int as digital_possible_visits,
         count(*) filter (where transfer_count > 0)::int as transfers
  from visit_history
  group by branch_id, date;

create or replace view feedback_daily as
  select branch_id, (at at time zone 'Asia/Kolkata')::date as date,
         round(avg(rating), 2) as csat, count(*)::int as n
  from feedback group by 1, 2;

create or replace view service_stats as
  select branch_id, final_service_id as service_id,
         count(*)::int as visits,
         count(*) filter (where could_be_digital)::int as could_be_digital,
         count(*) filter (where transfer_count > 0)::int as transferred_in,
         round(avg(handle_min), 1) as avg_handle
  from visit_history where status = 'COMPLETED'
  group by 1, 2;

create or replace view staff_stats as
  select branch_id, staff_id, count(*)::int as served, round(avg(handle_min), 2) as avg_handle
  from visit_history where status = 'COMPLETED' and staff_id is not null and transfer_count = 0
  group by 1, 2;

create or replace view feedback_topics as
  select branch_id, unnest(topics) as topic, sentiment, count(*)::int as n
  from feedback group by 1, 2, 3;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant select on visit_hourly, visit_daily, feedback_daily, service_stats, staff_stats, feedback_topics
      to anon, authenticated, service_role;
  end if;
end $$;
