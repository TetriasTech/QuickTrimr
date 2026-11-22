-- P2-T11 / TRIMR-54. RULE-AVAIL-09 and RULE-BARBER-INBOX-01.
begin;

create index bookings_available_now_barber_status_idx
  on public.bookings(barber_id, status) where booking_type = 'available_now';

-- Acceptance must take the barber profile lock before consulting this same
-- predicate and creating a booking. The inbox only reads a snapshot of it.
create function private.has_active_available_now_job(p_barber_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.bookings
    where barber_id = p_barber_id and booking_type = 'available_now'
      and status in (
        'accepted_pending_payment', 'paid_confirmed', 'on_the_way', 'arrived',
        'completed_by_barber', 'completion_prompt_sent'
      )
  );
$$;
revoke all on function private.has_active_available_now_job(uuid)
  from public, anon, authenticated, service_role;

create function public.get_barber_request_inbox_page(
  p_after_expires_at timestamptz default null, p_after_request_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  page jsonb;
begin
  -- This delegate verifies the caller's JWT, persisted role and cursor before
  -- either projection is returned. Both reads use the same statement snapshot.
  page := public.list_barber_booking_requests(
    p_after_expires_at => p_after_expires_at, p_after_request_id => p_after_request_id
  );
  return page || jsonb_build_object(
    'hasActiveAvailableNowJob', private.has_active_available_now_job(auth.uid())
  );
end;
$$;
revoke all on function public.get_barber_request_inbox_page(timestamptz,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_barber_request_inbox_page(timestamptz,uuid)
  to authenticated;

commit;
