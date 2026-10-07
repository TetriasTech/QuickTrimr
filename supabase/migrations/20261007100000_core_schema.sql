-- P0-T10 / TRIMR-19. Minimal foundation; feature fields ship with their feature.
-- No policy, business-number default, provider call or financial calculation here.
begin;

create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Exact shared tuples. CI and live catalog tests check both labels and order.
create type public.user_role as enum ('client', 'barber', 'admin');
create type public.verification_status as enum ('not_started', 'pending', 'verified', 'failed', 'requires_review');
create type public.booking_type as enum ('available_now', 'scheduled');
create type public.booking_status as enum ('requested', 'expired', 'declined', 'accepted_pending_payment', 'paid_confirmed', 'on_the_way', 'arrived', 'completed_by_barber', 'completed_by_client', 'completion_prompt_sent', 'completed', 'cancelled', 'disputed', 'refunded', 'admin_resolved');
create type public.request_status as enum ('pending', 'accepted', 'declined', 'expired', 'cancelled');
create type public.payment_status as enum ('requires_authorisation', 'authorised', 'authorisation_cancelled', 'capture_pending', 'captured', 'capture_failed', 'refunded', 'partially_refunded', 'disputed');
create type public.earning_status as enum ('pending', 'available', 'queued_for_payout', 'paid_out', 'reversed');
create type public.payout_status as enum ('draft', 'queued', 'processing', 'paid', 'failed', 'cancelled');
create type public.avail_status as enum ('active', 'busy', 'expired', 'manually_disabled', 'auto_disabled', 'cancelled');
create type public.dispute_status as enum ('open', 'under_review', 'resolved_client_refund', 'resolved_barber_paid', 'resolved_partial_refund', 'resolved_operational', 'cancelled');
create type public.reliability_level as enum ('good_standing', 'watch', 'limited', 'restricted', 'suspended');

-- All references restrict deletion. Account erasure/anonymisation is not implemented
-- by cascading through financial history. Child profile IDs are the Auth/profile ID.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  role public.user_role not null,
  verification_status public.verification_status not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.client_profiles (
  id uuid primary key references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.barber_profiles (
  id uuid primary key references public.profiles(id) on delete restrict,
  service_area extensions.geography(Point, 4326),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.client_addresses (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.client_profiles(id) on delete restrict,
  location extensions.geography(Point, 4326) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.barber_services (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barber_profiles(id) on delete restrict,
  service_category_id uuid not null references public.service_categories(id) on delete restrict,
  price_cents integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.available_now_sessions (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barber_profiles(id) on delete restrict,
  location extensions.geography(Point, 4326) not null,
  status public.avail_status not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.client_profiles(id) on delete restrict,
  barber_id uuid not null references public.barber_profiles(id) on delete restrict,
  booking_type public.booking_type not null,
  status public.request_status not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.booking_requests(id) on delete restrict,
  client_id uuid not null references public.client_profiles(id) on delete restrict,
  barber_id uuid not null references public.barber_profiles(id) on delete restrict,
  booking_type public.booking_type not null,
  status public.booking_status not null,
  service_price_cents integer not null,
  commission_pct_snapshot integer not null,
  gross_cents integer not null,
  commission_cents integer not null,
  barber_net_cents integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.booking_services (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  barber_service_id uuid not null references public.barber_services(id) on delete restrict,
  service_price_cents integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Nullable actor pair represents no human actor, not a client-selectable system role.
-- entity_id in audit_logs is deliberately polymorphic, not a dangling FK to one table.
create table public.booking_status_history (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  from_status public.booking_status,
  to_status public.booking_status not null,
  actor_id uuid references public.profiles(id) on delete restrict,
  actor_role public.user_role,
  reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_history_actor_pair check ((actor_id is null) = (actor_role is null))
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  status public.payment_status not null,
  gross_cents integer not null,
  refunded_cents integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.barber_earnings (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  barber_id uuid not null references public.barber_profiles(id) on delete restrict,
  status public.earning_status not null,
  gross_cents integer not null,
  commission_cents integer not null,
  barber_net_cents integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payout_batches (
  id uuid primary key default gen_random_uuid(),
  status public.payout_status not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Per-barber obligation (RULE-EARN-07). P3-T10 adds earning allocation/period guards;
-- P3-T11 adds provider/attempt reconciliation. Neither mechanism exists here yet.
create table public.payout_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.payout_batches(id) on delete restrict,
  barber_id uuid not null references public.barber_profiles(id) on delete restrict,
  status public.payout_status not null,
  barber_net_cents integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  status public.dispute_status not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete restrict,
  actor_role public.user_role,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint audit_actor_pair check ((actor_id is null) = (actor_role is null))
);

create table public.barber_reliability_events (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barber_profiles(id) on delete restrict,
  booking_id uuid references public.bookings(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.barber_reliability_state (
  id uuid primary key references public.barber_profiles(id) on delete restrict,
  level public.reliability_level not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index available_now_one_active_per_barber
  on public.available_now_sessions (barber_id) where status = 'active';
create index available_now_location_gist on public.available_now_sessions using gist (location);
create index barber_service_area_gist on public.barber_profiles using gist (service_area);
create index bookings_status_idx on public.bookings (status);
create index bookings_booking_type_idx on public.bookings (booking_type);
create index booking_requests_status_idx on public.booking_requests (status);
create index booking_requests_booking_type_idx on public.booking_requests (booking_type);
create index available_now_status_idx on public.available_now_sessions (status);
create index payments_status_idx on public.payments (status);
create index disputes_status_idx on public.disputes (status);

-- Not exposed as PostgREST RPCs. Invoker triggers do not elevate a caller's role.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create function private.reject_append_only_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'Append-only records cannot be changed; append a correction.';
end;
$$;
revoke all on function private.touch_updated_at() from public, anon, authenticated;
revoke all on function private.reject_append_only_mutation() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'client_profiles', 'barber_profiles', 'client_addresses',
    'service_categories', 'barber_services', 'available_now_sessions',
    'booking_requests', 'bookings', 'booking_services', 'booking_status_history',
    'payments', 'barber_earnings', 'payout_batches', 'payout_batch_items',
    'disputes', 'reviews', 'notifications', 'audit_logs',
    'barber_reliability_events', 'barber_reliability_state'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    -- RLS cannot block TRUNCATE. Remove implicit Supabase ALL grants first.
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', table_name);
    execute format('grant select, insert, update, delete on table public.%I to anon, authenticated, service_role', table_name);
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()', table_name);
    execute format('create index %I on public.%I (created_at)', table_name || '_created_at_idx', table_name);
  end loop;
  foreach table_name in array array['booking_status_history', 'audit_logs', 'barber_reliability_events'] loop
    execute format('create trigger reject_append_only_mutation before update or delete on public.%I for each row execute function private.reject_append_only_mutation()', table_name);
    execute format('create trigger reject_append_only_truncate before truncate on public.%I for each statement execute function private.reject_append_only_mutation()', table_name);
  end loop;
end;
$$;

-- Index every single-column FK unless a leading PK/unique/full index covers it.
-- A partial index cannot cover historical sessions, so it does not count here.
do $$
declare
  fk record;
begin
  for fk in
    select c.conrelid, t.relname, a.attname, a.attnum
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and n.nspname = 'public'
      and not exists (
        select 1 from pg_index i where i.indrelid = c.conrelid
          and i.indkey[0] = c.conkey[1] and i.indpred is null
      )
  loop
    execute format('create index %I on public.%I (%I)', fk.relname || '_' || fk.attname || '_idx', fk.relname, fk.attname);
  end loop;
end;
$$;

commit;
