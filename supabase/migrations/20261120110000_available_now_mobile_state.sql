-- P2-T02 / TRIMR-45: owner read projection and UI location-input adapter.
begin;
-- A generic full-text plan can prefer the ID index plus LIMIT and scan most of
-- G-NAF for a rare prefix. Plan the fixed, bound query with its actual tsquery.
-- No user text is concatenated into SQL; candidate projection and limit are unchanged.
create or replace function private.search_address_directory(input text) returns jsonb
language plpgsql stable set search_path='' as $$
declare query_value tsquery; result jsonb;
begin
  select to_tsquery('pg_catalog.simple',coalesce(string_agg(quote_literal(token)||':*',' & '),''))
    into query_value from unnest(string_to_array(private.address_search_key(input),' ')) tokens(token)
    where token<>'';
  execute $query$
    select coalesce(jsonb_agg(private.address_candidate(r.address) order by r.id),'[]'::jsonb)
    from (select a as address,a.id from private.address_directory a
      where a.search_document @@ $1 order by a.id limit 8) r
  $query$ into result using query_value;
  return result;
end $$;

alter table public.barber_reliability_state add column recovery_eligible_at timestamptz
  check (recovery_eligible_at is null or isfinite(recovery_eligible_at));
-- Nullable read-side evidence only. P3-T12 owns production/recovery; reads never
-- calculate offences, reset deadlines, or grant eligibility from this timestamp.
create index available_now_owner_latest on public.available_now_sessions
  (barber_id,(status='active') desc,updated_at desc,id desc);

create function public.get_available_now_state(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  server_now timestamptz := clock_timestamp();
  current_session public.available_now_sessions;
  standing public.barber_reliability_state;
  bounds jsonb;
  max_hours numeric;
  area jsonb;
  session_json jsonb;
begin
  if auth.role() is distinct from 'service_role' or not exists(
    select 1 from public.profiles where id=p_user_id and role='barber'
  ) then raise insufficient_privilege using message='available_now_forbidden'; end if;
  select value into bounds from private.platform_config where key='available_now_session_radius_km';
  select (value::text)::numeric into max_hours from private.platform_config where key='available_now_session_max_hours';
  select * into standing from public.barber_reliability_state where id=p_user_id;
  select * into current_session from public.available_now_sessions where barber_id=p_user_id
    order by (status='active') desc,updated_at desc,id desc limit 1;
  if found then
    select jsonb_build_object('id',id,'label',label) into area from public.public_areas where id=current_session.public_area_id;
    session_json := jsonb_build_object('id',current_session.id,'status',current_session.status,
      'isActive',coalesce(current_session.status='active' and current_session.available_until>server_now
        and current_session.radius_km is not null and current_session.location_source is not null and area is not null,false),
      'radiusKm',current_session.radius_km,'availableUntil',current_session.available_until,
      'locationSource',current_session.location_source,'approximateArea',area);
  end if;
  return jsonb_build_object('serverNow',server_now,
    'config',jsonb_build_object('minRadiusKm',(bounds->>'min')::numeric,'maxRadiusKm',(bounds->>'max')::numeric,'maxHours',max_hours),
    'onboardingEligible',exists(select 1 from private.connect_eligible_barbers where barber_id=p_user_id),
    'reliability',jsonb_build_object('level',coalesce(standing.level,'good_standing'),
      'cooldownUntil',standing.cooldown_until,'recoveryEligibleAt',standing.recovery_eligible_at,
      'reviewRequired',coalesce(standing.level in ('restricted','suspended'),false),
      'requiresHumanReinstatement',coalesce(standing.level='suspended',false),
      'availableNowAllowed',(select available_now_allowed from private.barber_booking_eligibility(p_user_id,server_now))),
    'session',session_json);
end $$;
revoke all on function public.get_available_now_state(uuid) from public,anon,authenticated;
grant execute on function public.get_available_now_state(uuid) to service_role;

-- Resolve only a user's selected directory entry or own stored session point.
-- Delegate to P2-T01 for the unchanged atomic state, bounds and eligibility rules.
create function public.available_now_mobile_input(p_user_id uuid,p_operation text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  point extensions.geography;
  source text;
  resolved_input jsonb := p_input;
begin
  if auth.role() is distinct from 'service_role' then raise insufficient_privilege using message='available_now_forbidden'; end if;
  perform 1 from public.profiles where id=p_user_id and role='barber' for update;
  if not found then raise insufficient_privilege using message='available_now_forbidden'; end if;
  if p_operation in ('start','update') and p_input ? 'directoryId' then
    if p_input->>'locationSource' is distinct from 'manual' or p_input ?| array['lat','lng','keepLocation'] then
      raise sqlstate 'PT422' using message='validation_failed',detail='{"directoryId":"Choose one location source."}';
    end if;
    select location into point from private.address_directory where id=p_input->>'directoryId';
    if not found then
      raise sqlstate 'PT422' using message='validation_failed',detail='{"directoryId":"Choose a suggested address."}';
    end if;
    source := 'manual';
  elsif p_input ? 'keepLocation' then
    if p_operation is distinct from 'update' or p_input->>'keepLocation' is distinct from 'true'
      or p_input ?| array['lat','lng','locationSource','directoryId'] then
      raise sqlstate 'PT422' using message='validation_failed',detail='{"keepLocation":"Choose one location source."}';
    end if;
    select location,location_source into point,source from public.available_now_sessions
      where id=(p_input->>'sessionId')::uuid and barber_id=p_user_id;
    if not found then raise sqlstate 'PT404' using message='not_found'; end if;
  end if;
  if point is not null then
    resolved_input := (p_input-'directoryId'-'keepLocation') || jsonb_build_object(
      'lat',extensions.st_y(point::extensions.geometry),'lng',extensions.st_x(point::extensions.geometry),'locationSource',source);
  end if;
  return public.manage_available_now_session(p_user_id,p_operation,resolved_input);
exception when invalid_text_representation then raise sqlstate 'PT422' using message='validation_failed';
end $$;
revoke all on function public.available_now_mobile_input(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.available_now_mobile_input(uuid,text,jsonb) to service_role;
commit;
