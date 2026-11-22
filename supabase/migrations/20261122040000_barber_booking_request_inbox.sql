-- P2-T10 / TRIMR-53. RULE-BARBER-INBOX-01, ROLE-BARBER and ADR-008.
begin;

insert into private.platform_config(key, value)
values ('barber_inbox_page_size', '{"default":20,"max":50}');

alter table private.booking_request_snapshots add column distance_band text;

-- P2-T08 has already checked coverage and locked the barber profile and
-- selected session, if any, before inserting the private snapshot. Capture
-- the band here while those same records are still locked.
create function private.capture_booking_request_distance_band() returns trigger
language plpgsql set search_path = '' as $$
declare
  origin extensions.geography;
  bands jsonb;
begin
  select case r.booking_type
    when 'available_now' then session.location
    when 'scheduled' then barber.service_area
  end into origin
  from public.booking_requests r
  join public.barber_profiles barber on barber.id = r.barber_id
  left join public.available_now_sessions session
    on session.id = r.available_now_session_id and session.barber_id = r.barber_id
  where r.id = new.request_id;

  select value into bands from private.platform_config where key = 'discovery_distance_bands';
  if origin is null or bands is null then
    raise exception 'booking_request_distance_unavailable';
  end if;
  new.distance_band := private.discovery_distance_band(
    extensions.st_distance(origin, new.address_location), bands
  );
  if new.distance_band is null then
    raise exception 'booking_request_distance_unavailable';
  end if;
  return new;
end;
$$;

revoke all on function private.capture_booking_request_distance_band()
  from public, anon, authenticated, service_role;
create trigger booking_request_distance_band before insert on private.booking_request_snapshots
  for each row execute function private.capture_booking_request_distance_band();

-- Only safely displayable requests have a deadline. Retain the status key to
-- support the equality filter followed by ordered deadline and ID lookup.
create index booking_requests_barber_inbox_idx
  on public.booking_requests(barber_id, status, expires_at, id)
  where expires_at is not null;

-- Private bounded query shared by the RPC and the plan/boundary verifier.
-- SQL invoker with qualified relations so the planner can inline the query.
create function private.barber_inbox_page(
  p_barber_id uuid, p_now timestamptz, p_request_id uuid,
  p_after_expires_at timestamptz, p_after_request_id uuid, p_probe_limit integer
) returns table (
  id uuid, booking_type public.booking_type, service_name text, price_cents integer,
  client_display_name text, suburb text, distance_band text, scheduled_for timestamptz,
  expires_at timestamptz, status public.request_status
)
language sql stable as $$
  select r.id, r.booking_type, s.service_snapshot->>'displayName', s.service_price_cents,
    s.client_snapshot->>'displayName', s.address_snapshot->>'suburb', s.distance_band,
    r.scheduled_for, r.expires_at, r.status
  from public.booking_requests r
  join private.booking_request_snapshots s on s.request_id = r.id
  where r.barber_id = p_barber_id and r.status = 'pending' and r.expires_at > p_now
    and (p_request_id is null or r.id = p_request_id)
    and (r.expires_at, r.id) > (
      coalesce(p_after_expires_at, '-infinity'::timestamptz),
      coalesce(p_after_request_id, '00000000-0000-0000-0000-000000000000'::uuid)
    )
  order by r.expires_at, r.id
  limit p_probe_limit;
$$;

revoke all on function private.barber_inbox_page(uuid,timestamptz,uuid,timestamptz,uuid,integer)
  from public, anon, authenticated, service_role;

create function public.list_barber_booking_requests(
  p_request_id uuid default null, p_after_expires_at timestamptz default null,
  p_after_request_id uuid default null, p_limit integer default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  server_now timestamptz := statement_timestamp();
  config jsonb;
  page_size integer;
  default_size integer;
  max_size integer;
  requests jsonb;
  next_cursor jsonb;
begin
  if caller is null or auth.role() is distinct from 'authenticated'
    or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true'
    or private.current_user_role() is distinct from 'barber'::public.user_role
  then
    raise insufficient_privilege using message = 'barber_inbox_forbidden';
  end if;

  if (p_after_expires_at is null) <> (p_after_request_id is null)
    or (p_request_id is not null and p_after_request_id is not null)
    or (p_after_expires_at is not null and not isfinite(p_after_expires_at))
  then
    raise sqlstate 'PT422' using message = 'validation_failed',
      detail = '{"cursor":"Use both cursor fields from the previous page, or omit both."}';
  end if;

  select value into config from private.platform_config where key = 'barber_inbox_page_size';
  default_size := (config->>'default')::integer;
  max_size := (config->>'max')::integer;
  if not coalesce(default_size > 0 and max_size >= default_size and max_size < 2147483647, false) then
    raise exception 'barber_inbox_config_invalid';
  end if;
  page_size := coalesce(p_limit, default_size);
  if page_size <= 0 or page_size > max_size then
    raise sqlstate 'PT422' using message = 'validation_failed',
      detail = jsonb_build_object('limit', format('Choose a whole-number page size between 1 and %s.', max_size))::text;
  end if;

  -- The probe fetches no more than one row above the configured page size.
  -- Cursor fields are already in the visible response. Every read rechecks
  -- ownership and current pending state, including reads using a cursor.
  with visible as (
    select page.*, row_number() over (order by expires_at, id) as position
    from private.barber_inbox_page(
      caller, server_now, p_request_id, p_after_expires_at, p_after_request_id, page_size + 1
    ) page
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'bookingType', booking_type, 'serviceName', service_name,
      'priceCents', price_cents, 'clientDisplayName', client_display_name,
      'clientRating', null, 'suburb', suburb, 'distanceBand', distance_band,
      'scheduledFor', scheduled_for, 'expiresAt', expires_at, 'status', status
    ) order by position) filter (where position <= page_size), '[]'::jsonb),
    case when count(*) > page_size then
      (jsonb_agg(jsonb_build_object('expiresAt', expires_at, 'requestId', id))
        filter (where position = page_size))->0
    end
    into requests, next_cursor
    from visible;

  return jsonb_build_object('requests', requests, 'serverNow', server_now, 'nextCursor', next_cursor);
end;
$$;

revoke all on function public.list_barber_booking_requests(uuid,timestamptz,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_barber_booking_requests(uuid,timestamptz,uuid,integer)
  to authenticated;

commit;
