-- Disposable P0-D07 laboratory only. NOT a QuickTrimr migration or booking implementation.
-- Synthetic state isolates scheduler delivery from payments, auth and marketplace rules.
create extension pg_cron;
create schema spike;
create role anon nologin;
create role authenticated nologin;
create role authenticator login noinherit;
grant anon, authenticated to authenticator;
grant usage on schema spike to anon, authenticated;

create table spike.requests (
  id text primary key,
  owner_id uuid not null default '00000000-0000-4000-8000-000000000001',
  state text not null default 'pending' check (state in ('pending', 'accepted', 'expired')),
  due_at timestamptz not null
);
create index requests_due_pending on spike.requests(due_at, id) where state = 'pending';
create table spike.effects (
  request_id text primary key references spike.requests(id),
  applied_at timestamptz not null default clock_timestamp(),
  reason text not null
);
alter table spike.requests enable row level security;
alter table spike.effects enable row level security;
-- Explicit deny-all policies: internal fixtures, not a public read/write API.
create policy requests_deny_clients on spike.requests to anon, authenticated
  using (false) with check (false);
create policy effects_deny_clients on spike.effects to anon, authenticated
  using (false) with check (false);
grant select, insert, update, delete on all tables in schema spike to anon, authenticated;

create function spike.immutable_effect() returns trigger language plpgsql as $$
begin raise exception 'Spike effect evidence is append-only'; end;
$$;
create trigger effects_append_only before update or delete on spike.effects
for each row execute function spike.immutable_effect();

-- Explicit time is a test seam available only to the private test runner, never mobile roles.
create function spike.fire(p_id text, p_now timestamptz, p_reason text default 'delivery')
returns integer language sql as $$
  with changed as (
    update spike.requests set state = 'expired'
    where id = p_id and state = 'pending' and due_at <= p_now
    returning id
  ), recorded as (
    insert into spike.effects(request_id, reason)
    select id, p_reason from changed returning request_id
  ) select count(*)::integer from recorded;
$$;

create function spike.sweep(p_now timestamptz, p_limit integer default 100)
returns integer language sql as $$
  with due as (
    select id from spike.requests where state = 'pending' and due_at <= p_now
    order by due_at, id limit p_limit for update skip locked
  ), changed as (
    update spike.requests r set state = 'expired' from due
    where r.id = due.id and r.state = 'pending' and r.due_at <= p_now returning r.id
  ), recorded as (
    insert into spike.effects(request_id, reason)
    select id, 'reconciliation' from changed returning request_id
  ) select count(*)::integer from recorded;
$$;

create function spike.accept(p_id text) returns integer language sql as $$
  with changed as (
    update spike.requests set state = 'accepted'
    where id = p_id and state = 'pending' returning id
  ) select count(*)::integer from changed;
$$;
revoke all on all functions in schema spike from public, anon, authenticated;

-- Long-history fixture for EXPLAIN, not a throughput claim about real booking traffic.
insert into spike.requests(id, state, due_at)
select 'history-' || n, 'accepted', clock_timestamp() - interval '1 day'
from generate_series(1, 100000) n;
analyze spike.requests;
