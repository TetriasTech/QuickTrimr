-- P2-T09. Own review/status projections and atomic review-to-snapshot comparison.
begin;

create index booking_requests_latest_client_idx
  on public.booking_requests(client_id, created_at desc, id desc)
  where expires_at is not null;

create function private.require_booking_request_client() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null or auth.role() is distinct from 'authenticated'
    or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true'
    or not exists (select 1 from public.profiles where id = caller and role = 'client')
  then
    raise insufficient_privilege using message = 'request_forbidden';
  end if;
  return caller;
end;
$$;

-- A fingerprint of reviewed server facts. This is a comparison precondition,
-- never authorization, a price override, or a client-chosen idempotency key.
create function private.booking_request_review_token(
  client_id uuid, kind public.booking_type, barber_id uuid, category_id uuid,
  scheduled_for timestamptz, barber_name text, service_name text, price integer,
  address jsonb, point extensions.geography, refund_pct integer, late_window integer
) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(jsonb_build_array(
    client_id, kind, barber_id, category_id, extract(epoch from scheduled_for),
    barber_name, service_name, price, address, point::text, refund_pct,
    case when kind = 'scheduled' then late_window end
  )::text, 'sha256'), 'hex');
$$;

create function public.get_booking_request_review(p_input jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' set timezone = 'UTC' as $$
declare
  caller uuid := private.require_booking_request_client();
  kind public.booking_type := (p_input->>'bookingType')::public.booking_type;
  target_barber uuid := (p_input->>'barberId')::uuid;
  target_category uuid := (p_input->>'serviceCategoryId')::uuid;
  requested timestamptz := (p_input->>'scheduledFor')::timestamptz;
  address public.client_addresses;
  saved_address jsonb;
  barber_name text;
  service_name text;
  price integer;
  config jsonb;
  lead integer;
  horizon integer;
  refund_pct integer;
  late_window integer;
  scheduled_issue text;
begin
  if kind is null or (kind = 'available_now' and requested is not null) then
    raise sqlstate 'PT422' using message = 'validation_failed';
  end if;
  select a.* into address from public.client_addresses a
    where a.id = (p_input->>'clientAddressId')::uuid and a.client_id = caller
      and a.archived_at is null and a.directory_id is not null;
  if not found then
    raise sqlstate 'PT422' using message = 'address_unavailable';
  end if;
  saved_address := private.saved_address(address);
  select b.display_name, c.display_name, s.price_cents into barber_name, service_name, price
    from private.connect_eligible_barbers e
    join public.barber_profiles b on b.id = e.barber_id
    join public.barber_services s on s.barber_id = b.id
    join public.service_categories c on c.id = s.service_category_id
    where e.barber_id = target_barber and c.id = target_category
      and b.display_name is not null and s.archived_at is null and c.archived_at is null
      and s.price_cents between c.min_price_cents and c.max_price_cents;
  if not found then
    return null;
  end if;

  select jsonb_object_agg(key,value) into config from private.platform_config
    where key in ('scheduled_min_lead_minutes', 'scheduled_max_horizon_days',
                  'cancel_refund_pct', 'late_cancel_window_hours');
  refund_pct := (config->'cancel_refund_pct'->>kind::text)::integer;
  if refund_pct is null or refund_pct not between 0 and 100 then
    raise exception 'request_config_invalid';
  end if;
  if kind = 'scheduled' then
    lead := (config->>'scheduled_min_lead_minutes')::integer;
    horizon := (config->>'scheduled_max_horizon_days')::integer;
    late_window := (config->>'late_cancel_window_hours')::integer;
    if lead is null or horizon is null or late_window is null or late_window <= 0
      or lead <= 0 or horizon <= 0 or lead::bigint > horizon::bigint * 24 * 60
    then
      raise exception 'request_config_invalid';
    end if;
    scheduled_issue := private.request_scheduled_error(requested, clock_timestamp(), lead, horizon);
  end if;
  return jsonb_build_object(
    'barberName', barber_name, 'serviceName', service_name, 'priceCents', price,
    'address', saved_address, 'scheduledIssue', scheduled_issue,
    'cancellation', jsonb_build_object('refundPct', refund_pct, 'lateWindowHours', late_window),
    'reviewToken', private.booking_request_review_token(
      caller, kind, target_barber, target_category, requested, barber_name, service_name,
      price, saved_address, address.location, refund_pct, late_window
    )
  );
end;
$$;

create function public.get_client_booking_request(
  p_request_id uuid default null, p_active_available_now boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  caller uuid := private.require_booking_request_client();
  server_now timestamptz := clock_timestamp();
  request public.booking_requests;
begin
  if p_request_id is not null then
    select * into request from public.booking_requests r
      where r.id = p_request_id and r.client_id = caller and r.expires_at is not null;
  elsif p_active_available_now then
    select * into request from public.booking_requests r
      where r.client_id = caller and r.booking_type = 'available_now'
        and r.status = 'pending' and r.expires_at > server_now
      order by r.expires_at desc limit 1;
  else
    select * into request from public.booking_requests r
      where r.client_id = caller and r.expires_at is not null
      order by r.created_at desc, r.id desc limit 1;
  end if;
  if request.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'id', request.id, 'bookingType', request.booking_type, 'status', request.status,
    'expiresAt', request.expires_at, 'serverNow', server_now
  );
end;
$$;

-- Keep the existing creation transaction and downstream contract. Raising
-- within its wrapper rolls back the request, snapshot, and audit together.
alter function public.create_booking_request(uuid,jsonb) set schema private;
create function public.create_booking_request(p_client_id uuid, p_input jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  result jsonb;
  token text := p_input->>'reviewToken';
  snapshot_token text;
begin
  result := private.create_booking_request(p_client_id, p_input);
  if token is not null then
    select private.booking_request_review_token(
      r.client_id, r.booking_type, r.barber_id, r.service_category_id, r.scheduled_for,
      s.barber_snapshot->>'displayName', s.service_snapshot->>'displayName',
      s.service_price_cents, s.address_snapshot, s.address_location,
      s.cancellation_refund_pct, s.late_cancel_window_hours
    ) into strict snapshot_token
    from public.booking_requests r
    join private.booking_request_snapshots s on s.request_id = r.id
    where r.id = (result->>'id')::uuid;
    if token is distinct from snapshot_token then
      raise sqlstate 'PT409' using message = 'review_changed';
    end if;
  end if;
  return result;
end;
$$;

revoke all on function private.require_booking_request_client(),
  private.booking_request_review_token(uuid,public.booking_type,uuid,uuid,timestamptz,text,text,integer,jsonb,extensions.geography,integer,integer),
  private.create_booking_request(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.get_booking_request_review(jsonb),
  public.get_client_booking_request(uuid,boolean) from public, anon, authenticated, service_role;
grant execute on function public.get_booking_request_review(jsonb),
  public.get_client_booking_request(uuid,boolean) to authenticated;
revoke all on function public.create_booking_request(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.create_booking_request(uuid,jsonb) to service_role;

commit;
