-- P2-T12 / TRIMR-55. First valid acceptance wins, with no provider I/O.
begin;

create unique index bookings_one_per_request on public.bookings(request_id);
create index booking_requests_pending_available_barber_idx
  on public.booking_requests(barber_id)
  where booking_type = 'available_now' and status = 'pending';

-- SQL counterpart to requestDeadlineReached. Keep native microsecond precision.
create function private.booking_request_deadline_reached(
  deadline timestamptz, server_now timestamptz
) returns boolean language sql immutable strict set search_path = '' as $$
  select deadline <= server_now;
$$;
revoke all on function private.booking_request_deadline_reached(timestamptz,timestamptz)
  from public, anon, authenticated, service_role;

create function public.accept_booking_request(p_barber_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target public.booking_requests;
  snapshot record;
  booking_id uuid;
  server_now timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  -- Parent first serializes creation, acceptance, session and restriction writers.
  perform 1 from public.profiles where id = p_barber_id and role = 'barber' for update;
  if not found then raise insufficient_privilege using message = 'forbidden'; end if;
  select * into target from public.booking_requests
    where id = p_request_id and barber_id = p_barber_id for update;
  if not found then raise insufficient_privilege using message = 'forbidden'; end if;

  -- Check the clock after any lock wait. PostgreSQL's transaction and statement
  -- timestamps can predate both the deadline and a committed restriction.
  server_now := clock_timestamp();
  if target.status <> 'pending' or target.expires_at is null
    or private.booking_request_deadline_reached(target.expires_at, server_now)
  then
    raise sqlstate 'PT409' using message = 'request_not_pending';
  end if;
  if not exists (
    select 1 from private.barber_booking_eligibility(p_barber_id, server_now) eligibility
    where case target.booking_type
      when 'available_now' then eligibility.available_now_allowed
      when 'scheduled' then eligibility.scheduled_allowed
    end
  ) then
    raise sqlstate 'PT409' using message = 'barber_unavailable';
  end if;
  if target.booking_type = 'available_now' and private.has_active_available_now_job(p_barber_id) then
    raise sqlstate 'PT409' using message = 'active_job_exists';
  end if;

  select service_price_cents, commission_pct_snapshot, gross_cents, commission_cents, barber_net_cents
    into snapshot from private.booking_request_snapshots where request_id = target.id;
  if not found or target.barber_service_id is null then
    raise sqlstate 'PT409' using message = 'request_not_pending';
  end if;
  update public.booking_requests set status = 'accepted'
    where id = target.id and status = 'pending';
  if not found then raise sqlstate 'PT409' using message = 'request_not_pending'; end if;

  insert into public.bookings(
    request_id, client_id, barber_id, booking_type, status, service_price_cents,
    commission_pct_snapshot, gross_cents, commission_cents, barber_net_cents, created_at, updated_at
  ) values (
    target.id, target.client_id, target.barber_id, target.booking_type, 'accepted_pending_payment',
    snapshot.service_price_cents, snapshot.commission_pct_snapshot, snapshot.gross_cents,
    snapshot.commission_cents, snapshot.barber_net_cents, server_now, server_now
  ) on conflict (request_id) do nothing returning id into booking_id;
  if not found then raise sqlstate 'PT409' using message = 'request_not_pending'; end if;
  insert into public.booking_services(booking_id, barber_service_id, service_price_cents, created_at, updated_at)
    values (booking_id, target.barber_service_id, snapshot.service_price_cents, server_now, server_now);
  insert into public.booking_status_history(booking_id, to_status, actor_id, actor_role, reason, created_at, updated_at)
    values (booking_id, 'accepted_pending_payment', p_barber_id, 'barber',
      'Barber accepted the booking request.', server_now, server_now);
  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id,
    previous_value, new_value, reason, metadata, created_at, updated_at)
    values (p_barber_id, 'barber', 'booking_request.accepted', 'booking_requests', target.id,
      jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'accepted'),
      'Barber accepted the booking request.', jsonb_build_object('bookingId', booking_id, 'bookingType', target.booking_type),
      server_now, server_now);

  if target.booking_type = 'available_now' then
    perform private.record_available_now_request_outcome(target.id, 'accepted');
    with closed as (
      update public.booking_requests set status = case
        when private.booking_request_deadline_reached(expires_at, server_now) then 'expired'::public.request_status
        else 'declined'::public.request_status
      end
      where barber_id = p_barber_id and booking_type = 'available_now' and status = 'pending'
      returning id, status
    )
    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id,
      previous_value, new_value, reason, metadata, created_at, updated_at)
      select p_barber_id, 'barber', 'booking_request.closed_after_acceptance', 'booking_requests', id,
        jsonb_build_object('status', 'pending'), jsonb_build_object('status', status),
        'Another Available Now request was accepted.', jsonb_build_object('acceptingRequestId', target.id),
        server_now, server_now
      from closed;
  end if;

  return jsonb_build_object('requestId', target.id, 'bookingId', booking_id,
    'requestStatus', 'accepted', 'bookingStatus', 'accepted_pending_payment');
end;
$$;
revoke all on function public.accept_booking_request(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.accept_booking_request(uuid,uuid) to service_role;

commit;
