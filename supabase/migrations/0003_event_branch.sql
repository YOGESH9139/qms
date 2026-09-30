-- token_events carry branch_id so alert rules (no-show spike, misrouting) can query cheaply.
alter table token_events add column if not exists branch_id text references branches(id) on delete cascade;
create index if not exists token_events_branch_at_idx on token_events(branch_id, at);
