-- P2-T01 / TRIMR-44. RULE-AVAIL-01/02/08, RULE-RELY-06, ADR-008/013.
begin;
-- Internal invoker helpers resolve PostGIS types/functions without platform defaults.
grant usage on schema extensions to service_role;
insert into private.platform_config(key,value) values
  ('available_now_session_radius_km','{"min":1,"max":50}'),
  ('available_now_session_max_hours','12');

-- Legacy foundation fixtures remain intact, but incomplete rows are never discoverable.
alter table public.available_now_sessions
  add column location_source text check (location_source in ('gps','manual')),
  add column radius_km numeric check (radius_km > 0 and radius_km <> 'NaN'::numeric),
  add column available_until timestamptz check (isfinite(available_until)),
  add column public_area_id text references public.public_areas(id) on delete restrict;
alter table public.barber_reliability_state add column cooldown_until timestamptz
  check (cooldown_until is null or isfinite(cooldown_until));
grant select(location_source,radius_km,available_until,public_area_id) on public.available_now_sessions to authenticated;
grant select(cooldown_until) on public.barber_reliability_state to authenticated;
revoke insert,update,delete,truncate on public.available_now_sessions, public.barber_reliability_state
  from public,anon,authenticated,service_role;

-- This is the authoritative, set-based server read policy. Domain parity tests
-- cover all levels/deadline boundaries. Missing state means no offences yet.
-- Future P3-T12 restriction writers MUST lock profiles FOR UPDATE before writing
-- reliability state, the same parent-first protocol used by activation/acceptance.
create function private.barber_booking_eligibility(p_barber_id uuid, p_now timestamptz)
returns table(available_now_allowed boolean, scheduled_allowed boolean, search_demoted boolean)
language sql stable as $$
  select coalesce(r.level <> 'suspended' and (r.cooldown_until is null or r.cooldown_until <= p_now),true),
    coalesce(r.level <> 'suspended',true), coalesce(r.level = 'restricted',false)
  from (select p_barber_id as id) b left join public.barber_reliability_state r using(id);
$$;
revoke all on function private.barber_booking_eligibility(uuid,timestamptz) from public,anon,authenticated;
grant execute on function private.barber_booking_eligibility(uuid,timestamptz) to service_role;

create function private.available_now_session_json(s public.available_now_sessions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id',s.id,'status',s.status,'radiusKm',s.radius_km,
    'availableUntil',s.available_until,'locationSource',s.location_source,
    'approximateArea',jsonb_build_object('id',a.id,'label',a.label))
  from public.public_areas a where a.id = s.public_area_id;
$$;
revoke all on function private.available_now_session_json(public.available_now_sessions)
  from public,anon,authenticated,service_role;

-- Pure SQL mirror of packages/domain availableNowBoundsFit. A supplied server
-- instant makes exact deadline parity reproducible without a production fake clock.
create function private.available_now_bound_errors(radius numeric,end_time timestamptz,server_now timestamptz,bounds jsonb,max_hours numeric)
returns jsonb language sql immutable set search_path = '' as $$
  select (case when radius is null or radius='NaN'::numeric or radius < (bounds->>'min')::numeric or radius > (bounds->>'max')::numeric
    then jsonb_build_object('radiusKm',format('Enter a radius between %s and %s km.',bounds->>'min',bounds->>'max')) else '{}'::jsonb end)
  || (case when end_time is null or not isfinite(end_time) or end_time <= server_now
    or end_time > server_now + max_hours * interval '1 hour'
    then jsonb_build_object('availableUntil',format('Must be in the future and within %s hours.',max_hours)) else '{}'::jsonb end);
$$;
revoke all on function private.available_now_bound_errors(numeric,timestamptz,timestamptz,jsonb,numeric) from public,anon,authenticated,service_role;

create function public.manage_available_now_session(p_user_id uuid,p_operation text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.available_now_sessions;
  prior public.available_now_sessions;
  server_now timestamptz;
  radius numeric;
  end_time timestamptz;
  point extensions.geography;
  area_id text;
  bounds jsonb;
  max_hours numeric;
  fields jsonb := '{}'::jsonb;
  action_name text;
begin
  if auth.role() is distinct from 'service_role' then
    raise insufficient_privilege using message = 'available_now_forbidden';
  end if;
  -- Serialize starts, role revocation and future restrictions before child locks.
  perform 1 from public.profiles where id=p_user_id and role='barber' for update;
  if not found then raise insufficient_privilege using message = 'available_now_forbidden'; end if;
  server_now := clock_timestamp(); -- sampled AFTER waiting for the parent lock
  if p_operation is null or p_operation not in ('start','update','stop')
    or p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise sqlstate 'PT422' using message='validation_failed';
  end if;
  if p_operation <> 'start' then
    select * into s from public.available_now_sessions
      where id=(p_input->>'sessionId')::uuid and barber_id=p_user_id for update;
    if not found then raise sqlstate 'PT404' using message='not_found'; end if;
    if p_operation='stop' and s.status='manually_disabled' then
      return jsonb_build_object('id',s.id,'status',s.status);
    end if;
    if s.status <> 'active' then
      raise sqlstate 'PT409' using message='invalid_status_transition';
    end if;
  end if;

  if p_operation='stop' then
    update public.available_now_sessions set status='manually_disabled',updated_at=server_now
      where id=s.id returning * into s;
    action_name := 'available_now.stopped';
  else
    if not exists (select 1 from private.connect_eligible_barbers where barber_id=p_user_id) then
      raise sqlstate 'PT403' using message='onboarding_incomplete';
    end if;
    if not (select available_now_allowed from private.barber_booking_eligibility(p_user_id,server_now)) then
      raise sqlstate 'PT409' using message='barber_unavailable';
    end if;
    if p_operation='update' and (s.available_until is null or s.available_until <= server_now) then
      raise sqlstate 'PT409' using message='invalid_status_transition';
    end if;
    select value into bounds from private.platform_config where key='available_now_session_radius_km';
    select (value::text)::numeric into max_hours from private.platform_config where key='available_now_session_max_hours';
    if bounds is null or max_hours is null or not (max_hours > 0 and max_hours < 'Infinity'::numeric)
      or not coalesce(jsonb_typeof(bounds->'min')='number' and jsonb_typeof(bounds->'max')='number'
        and (bounds->>'min')::numeric > 0 and (bounds->>'max')::numeric >= (bounds->>'min')::numeric
        and (bounds->>'max')::numeric < 'Infinity'::numeric,false) then
      raise exception 'available_now_config_invalid';
    end if;
    radius := (p_input->>'radiusKm')::numeric;
    end_time := (p_input->>'availableUntil')::timestamptz;
    fields := private.available_now_bound_errors(radius,end_time,server_now,bounds,max_hours);
    if not ((p_input->>'lat')::double precision between -90 and 90) or not ((p_input->>'lng')::double precision between -180 and 180)
      or p_input->>'lat' is null or p_input->>'lng' is null then
      fields := fields || '{"lat":"Enter a valid location.","lng":"Enter a valid location."}'::jsonb;
    end if;
    if p_input->>'locationSource' is null or p_input->>'locationSource' not in ('gps','manual') then
      fields := fields || '{"locationSource":"Choose GPS or manual location."}'::jsonb;
    end if;
    if fields <> '{}'::jsonb then
      raise sqlstate 'PT422' using message='validation_failed',detail=fields::text;
    end if;
    point := extensions.st_setsrid(extensions.st_makepoint((p_input->>'lng')::double precision,(p_input->>'lat')::double precision),4326)::extensions.geography;
    -- Same version/interior/code tie-break as P1-T06, including polygon boundaries.
    select a.id into area_id from public.public_areas a
      where extensions.st_covers(a.boundary,point::extensions.geometry)
      order by a.vintage desc,extensions.st_contains(a.boundary,point::extensions.geometry) desc,a.code limit 1;
    if area_id is null then
      raise sqlstate 'PT422' using message='validation_failed',detail='{"lat":"Choose a location within an Australian public area."}';
    end if;
    if p_operation='start' then
      for prior in update public.available_now_sessions set status='cancelled',updated_at=server_now
        where barber_id=p_user_id and status='active' returning * loop
        insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_value)
          values(p_user_id,'barber','available_now.replaced','available_now_session',prior.id,jsonb_build_object('status',prior.status));
      end loop;
      insert into public.available_now_sessions(barber_id,location,location_source,radius_km,available_until,public_area_id,status)
        values(p_user_id,point,p_input->>'locationSource',radius,end_time,area_id,'active') returning * into s;
      action_name := 'available_now.started';
    else
      update public.available_now_sessions set location=point,location_source=p_input->>'locationSource',
        radius_km=radius,available_until=end_time,public_area_id=area_id,updated_at=server_now
        where id=s.id returning * into s;
      action_name := 'available_now.updated';
    end if;
  end if;
  -- No private point or profile/contact data in the immutable audit trail.
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_value)
    values(p_user_id,'barber',action_name,'available_now_session',s.id,
      jsonb_build_object('status',s.status,'radiusKm',s.radius_km,'availableUntil',s.available_until,'locationSource',s.location_source));
  return case when p_operation='stop' then jsonb_build_object('id',s.id,'status',s.status)
    else private.available_now_session_json(s) end;
exception
  when not_null_violation or numeric_value_out_of_range or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise sqlstate 'PT422' using message='validation_failed';
end $$;
revoke all on function public.manage_available_now_session(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_available_now_session(uuid,text,jsonb) to service_role;

create function private.available_now_max_radius_meters() returns double precision
language sql stable security definer set search_path = '' as $$
  select (value->>'max')::double precision*1000 from private.platform_config
    where key='available_now_session_radius_km';
$$;
revoke all on function private.available_now_max_radius_meters() from public,anon,authenticated;
grant execute on function private.available_now_max_radius_meters() to service_role;

-- Internal candidate query, NOT the P2-T04 public endpoint. A constant upper
-- envelope permits GiST filtering before the exact per-session radius predicate.
-- Keyset UUID ordering and a caller-supplied bounded limit keep reads finite;
-- 100 is a transport safety ceiling, not a product search/page-size policy.
create function private.available_now_candidates(p_point extensions.geography,p_now timestamptz,p_after uuid,p_limit integer)
returns table(session_id uuid,barber_id uuid,public_area_id text,search_demoted boolean)
language sql stable as $$
  select s.id,s.barber_id,s.public_area_id,e.search_demoted
  from public.available_now_sessions s
  -- Parameterize the security-barrier view after spatial pruning; otherwise
  -- PostgreSQL may materialize every connected account before joining 20 nearby rows.
  join lateral (select 1 from private.connect_eligible_barbers c
    where c.barber_id=s.barber_id limit 1) c on true
  cross join lateral private.barber_booking_eligibility(s.barber_id,p_now) e
  where s.status='active' and s.available_until > p_now and s.location_source is not null
    and s.public_area_id is not null and e.available_now_allowed
    and (p_after is null or s.id > p_after)
    and extensions.st_dwithin(s.location,p_point,
      (select private.available_now_max_radius_meters()))
    and extensions.st_dwithin(s.location,p_point,s.radius_km::double precision*1000)
  order by s.id limit least(greatest(p_limit,0),100);
$$;
revoke all on function private.available_now_candidates(extensions.geography,timestamptz,uuid,integer) from public,anon,authenticated;
grant execute on function private.available_now_candidates(extensions.geography,timestamptz,uuid,integer) to service_role;
commit;
