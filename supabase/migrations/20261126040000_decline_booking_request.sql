-- P2-T13 / TRIMR-56. RULE-REQUEST-07 and the P2-T12 lock order.
begin;

create function public.decline_booking_request(
  p_barber_id uuid, p_request_id uuid, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target record;
  server_now timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  -- Mirror the shared reason codes at the trusted write boundary so even a
  -- service caller cannot put arbitrary text into the append-only audit.
  if p_reason is not null and p_reason not in ('too_far','unavailable','service_unavailable','other') then
    raise sqlstate 'PT422' using message = 'invalid_decline_reason';
  end if;

  -- Serialize with acceptance and session writers before locking the request.
  perform 1 from public.profiles where id = p_barber_id and role = 'barber' for update;
  if not found then raise insufficient_privilege using message = 'forbidden'; end if;
  select id, status, booking_type, expires_at into target from public.booking_requests
    where id = p_request_id and barber_id = p_barber_id for update;
  if not found then raise insufficient_privilege using message = 'forbidden'; end if;

  server_now := clock_timestamp();
  if target.status <> 'pending' or target.expires_at is null
    or private.booking_request_deadline_reached(target.expires_at, server_now)
  then
    raise sqlstate 'PT409' using message = 'request_not_pending';
  end if;
  update public.booking_requests set status = 'declined'
    where id = target.id and status = 'pending';
  if not found then raise sqlstate 'PT409' using message = 'request_not_pending'; end if;

  if target.booking_type = 'available_now' then
    perform private.record_available_now_request_outcome(target.id, 'declined');
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id,
    previous_value, new_value, reason, metadata, created_at, updated_at)
    values (p_barber_id, 'barber', 'booking_request.declined', 'booking_requests', target.id,
      jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'declined'),
      'Barber declined the booking request.',
      jsonb_strip_nulls(jsonb_build_object('bookingType', target.booking_type, 'declineReason', p_reason)),
      server_now, server_now);

  return jsonb_build_object('requestId', target.id, 'status', 'declined');
end;
$$;
revoke all on function public.decline_booking_request(uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.decline_booking_request(uuid,uuid,text) to service_role;

commit;
