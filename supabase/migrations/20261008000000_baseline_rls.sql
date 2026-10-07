-- P0-T11 / TRIMR-20. Read-only application baseline (ADR-001, KB access rules).
-- Feature writes remain server-owned; no INSERT/UPDATE/DELETE policy here.
begin;

-- No argument accepting a target user/role. auth.uid() comes from verified JWT
-- claims. The owner bypasses profiles RLS to avoid recursive role lookup.
create function private.current_user_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = (select auth.uid());
$$;
alter function private.current_user_role() owner to postgres;
revoke all on function private.current_user_role() from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;
grant execute on function private.current_user_role() to authenticated, service_role;

do $$
declare
  table_name text;
  readable_columns text;
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
    -- Capture ONLY columns delivered at this migration. ALTER TABLE ADD COLUMN
    -- later must not silently grant a new private field to every authenticated user.
    select string_agg(format('%I', a.attname), ', ' order by a.attnum)
      into readable_columns
      from pg_attribute a
      where a.attrelid = format('public.%I', table_name)::regclass
        and a.attnum > 0 and not a.attisdropped;
    execute format('revoke select on public.%I from public, anon, authenticated', table_name);
    execute format('grant select (%s) on public.%I to authenticated', readable_columns, table_name);
    execute format('create policy admin_read on public.%I for select to authenticated using ((select private.current_user_role()) = ''admin''::public.user_role)', table_name);
  end loop;
end;
$$;

create policy own_profile_read on public.profiles for select to authenticated
using ((select private.current_user_role()) in ('client', 'barber') and id = (select auth.uid()));

create policy own_client_profile_read on public.client_profiles for select to authenticated
using ((select private.current_user_role()) = 'client' and id = (select auth.uid()));

create policy own_barber_profile_read on public.barber_profiles for select to authenticated
using ((select private.current_user_role()) = 'barber' and id = (select auth.uid()));

create policy own_address_read on public.client_addresses for select to authenticated
using ((select private.current_user_role()) = 'client' and client_id = (select auth.uid()));

create policy own_service_read on public.barber_services for select to authenticated
using ((select private.current_user_role()) = 'barber' and barber_id = (select auth.uid()));

create policy own_session_read on public.available_now_sessions for select to authenticated
using ((select private.current_user_role()) = 'barber' and barber_id = (select auth.uid()));

create policy own_request_read on public.booking_requests for select to authenticated
using (case (select private.current_user_role())
  when 'client' then client_id = (select auth.uid())
  when 'barber' then barber_id = (select auth.uid())
  else false end);

create policy own_booking_read on public.bookings for select to authenticated
using (case (select private.current_user_role())
  when 'client' then client_id = (select auth.uid())
  when 'barber' then barber_id = (select auth.uid())
  else false end);

create policy own_earning_read on public.barber_earnings for select to authenticated
using ((select private.current_user_role()) = 'barber' and barber_id = (select auth.uid()));

create policy own_dispute_read on public.disputes for select to authenticated
using ((select private.current_user_role()) = 'client' and booking_id in (
  select b.id from public.bookings b where b.client_id = (select auth.uid())
));

create policy own_review_read on public.reviews for select to authenticated
using (case (select private.current_user_role())
  when 'client' then booking_id in (select b.id from public.bookings b where b.client_id = (select auth.uid()))
  when 'barber' then booking_id in (select b.id from public.bookings b where b.barber_id = (select auth.uid()))
  else false end);

-- These deliberate owner-rights views bypass base RLS ONLY for their explicit
-- projection and caller predicate. Never use SELECT *, remove a predicate, or
-- switch to invoker rights without reworking the underlying access contract.
-- security_barrier prevents caller filters from being pushed below the guard.
create view public.public_barber_profiles
with (security_barrier = true, security_invoker = false) as
select b.id from public.barber_profiles b
where (select private.current_user_role()) in ('client', 'barber', 'admin')
  and exists (select 1 from public.profiles p where p.id = b.id and p.role = 'barber');

create view public.client_payments
with (security_barrier = true, security_invoker = false) as
select p.id, p.booking_id, p.status, p.gross_cents, p.refunded_cents, p.created_at, p.updated_at
from public.payments p
where (select private.current_user_role()) = 'client'
  and p.booking_id in (select b.id from public.bookings b where b.client_id = (select auth.uid()));

alter view public.public_barber_profiles owner to postgres;
alter view public.client_payments owner to postgres;
revoke all on public.public_barber_profiles, public.client_payments from public, anon, authenticated, service_role;
grant select on public.public_barber_profiles, public.client_payments to authenticated, service_role;

commit;
