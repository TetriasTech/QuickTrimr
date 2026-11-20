-- P2-T03 / TRIMR-46. Four transitions, shared by current/future producers.
begin;
insert into private.platform_config(key,value) values
  ('missed_request_threshold','2'),
  ('available_now_worker_operations','{"sweepSeconds":10,"batchSize":500,"scheduledConcurrency":1,"healthCheckSeconds":60,"staleHeartbeatSeconds":120,"overdueSeconds":60,"runRetentionDays":30,"peakDueSessions":1000,"peakHistoricalSessions":100000,"peakExpiryLatenessSecondsExclusive":60}');

alter table public.available_now_sessions
  add column consecutive_misses integer not null default 0 check(consecutive_misses >= 0),
  add column disabled_reason text;
alter table public.booking_requests add column available_now_session_id uuid
  references public.available_now_sessions(id) on delete restrict;
create index available_now_due on public.available_now_sessions(available_until,id) include(barber_id)
  where status='active' and available_until is not null;

create table private.available_now_request_receipts(
  request_id uuid primary key references public.booking_requests(id) on delete restrict,
  session_id uuid not null references public.available_now_sessions(id) on delete restrict,
  outcome public.request_status not null check(outcome in ('expired','declined','accepted')),
  created_at timestamptz not null default clock_timestamp()
);
alter table private.available_now_request_receipts enable row level security;
revoke all on private.available_now_request_receipts from public,anon,authenticated,service_role;
create trigger reject_append_only_mutation before update or delete on private.available_now_request_receipts
  for each row execute function private.reject_append_only_mutation();
create trigger reject_append_only_truncate before truncate on private.available_now_request_receipts
  for each statement execute function private.reject_append_only_mutation();

-- Transactional mirror of the pure packages/domain policy. Exact parity is tested.
-- Clock injection exists only in this private, runtime-inaccessible pure helper.
create function private.available_now_transition_effect(
  current_status public.avail_status,misses integer,deadline timestamptz,
  event text,server_now timestamptz,threshold integer
) returns jsonb language plpgsql immutable set search_path='' as $$
declare next_status public.avail_status:=current_status; next_misses integer:=misses; reason text; applied boolean;
begin
  if threshold is null or threshold<=0 or misses is null or misses<0
    or server_now is null or not isfinite(server_now)
    or (deadline is not null and not isfinite(deadline))
    or event is null or event not in ('expired','missed','responded','accepted','manually_disabled','check_misses') then
    raise exception 'available_now_transition_invalid';
  end if;
  if current_status='active' then
    case event
      when 'expired' then
        if deadline<=server_now then next_status:='expired'; reason:='Available-until deadline reached.'; end if;
      when 'missed','check_misses' then
        if event='missed' then next_misses:=misses+1; end if;
        if next_misses>=threshold then next_status:='auto_disabled'; reason:='missed_requests';
        elsif event='missed' then reason:='Unanswered request expired.'; end if;
      when 'responded' then next_misses:=0; reason:='Barber responded to a request.';
      when 'accepted' then next_misses:=0; next_status:='busy'; reason:='Available Now booking accepted.';
      when 'manually_disabled' then next_status:='manually_disabled'; reason:='Barber manually stopped availability.';
    end case;
  end if;
  applied:=next_status is distinct from current_status or next_misses<>misses;
  return jsonb_build_object('status',next_status,'misses',next_misses,'reason',case when applied then reason end,'applied',applied);
end $$;
revoke all on function private.available_now_transition_effect(public.avail_status,integer,timestamptz,text,timestamptz,integer)
  from public,anon,authenticated,service_role;

create function private.transition_available_now_session(p_session_id uuid,p_event text,p_actor_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.available_now_sessions; before_value jsonb; effect jsonb; threshold integer; server_now timestamptz;
begin
  -- Never acquire a child lock before its profile parent. For system events the
  -- actor remains null; the separate lookup supplies only the lock target.
  perform 1 from public.profiles where id=(select barber_id from public.available_now_sessions where id=p_session_id) for update;
  select * into s from public.available_now_sessions where id=p_session_id for update;
  if not found then raise sqlstate 'PT404' using message='not_found'; end if;
  if p_actor_id is not null and (p_actor_id<>s.barber_id or not exists(
    select 1 from public.profiles where id=p_actor_id and role='barber'
  )) then raise insufficient_privilege using message='forbidden'; end if;
  server_now:=clock_timestamp();
  select (value::text)::integer into threshold from private.platform_config where key='missed_request_threshold';
  effect:=private.available_now_transition_effect(s.status,s.consecutive_misses,s.available_until,p_event,server_now,threshold);
  if (effect->>'applied')::boolean then
    before_value:=jsonb_build_object('status',s.status,'misses',s.consecutive_misses);
    update public.available_now_sessions set status=(effect->>'status')::public.avail_status,
      consecutive_misses=(effect->>'misses')::integer,
      disabled_reason=case when effect->>'status'='auto_disabled' then 'missed_requests' else disabled_reason end,
      updated_at=server_now where id=s.id;
    insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,previous_value,new_value,reason,metadata)
      values(p_actor_id,case when p_actor_id is not null then 'barber'::public.user_role end,
        'available_now.'||case when p_event='manually_disabled' then 'stopped' else p_event end,'available_now_session',s.id,before_value,
        jsonb_build_object('status',effect->>'status','misses',(effect->>'misses')::integer),effect->>'reason',
        jsonb_build_object('missedRequestThreshold',threshold));
  end if;
  return jsonb_build_object('sessionId',s.id,'applied',(effect->>'applied')::boolean,'status',effect->>'status');
end $$;
revoke all on function private.transition_available_now_session(uuid,text,uuid) from public,anon,authenticated,service_role;

-- Only trusted request producers call this after their terminal transition,
-- inside the same transaction. Bulk resolution does not call this function.
create function private.record_available_now_request_outcome(p_request_id uuid,p_outcome public.request_status)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.booking_requests; source_session public.available_now_sessions; current_session uuid;
begin
  perform 1 from public.profiles where id=(select barber_id from public.booking_requests where id=p_request_id) for update;
  select * into r from public.booking_requests where id=p_request_id for update;
  if not found then raise sqlstate 'PT404' using message='not_found'; end if;
  if r.booking_type<>'available_now' then return false; end if;
  if p_outcome is null or p_outcome not in ('expired','declined','accepted') or r.status<>p_outcome then
    raise sqlstate 'PT409' using message='request_outcome_mismatch';
  end if;
  select * into source_session from public.available_now_sessions where id=r.available_now_session_id;
  if not found or source_session.barber_id<>r.barber_id then
    raise sqlstate 'PT409' using message='request_session_missing';
  end if;
  insert into private.available_now_request_receipts(request_id,session_id,outcome)
    values(r.id,source_session.id,p_outcome) on conflict(request_id) do nothing;
  if not found then return false; end if;
  if p_outcome='accepted' then
    -- A valid acceptance disables the CURRENT active session, even when the
    -- request was issued during an older session. Ended sessions stay ended.
    select id into current_session from public.available_now_sessions where barber_id=r.barber_id and status='active';
    if found then perform private.transition_available_now_session(current_session,'accepted',r.barber_id); end if;
  else
    perform private.transition_available_now_session(source_session.id,
      case when p_outcome='expired' then 'missed' else 'responded' end,
      case when p_outcome='declined' then r.barber_id end);
  end if;
  return true;
end $$;
revoke all on function private.record_available_now_request_outcome(uuid,public.request_status) from public,anon,authenticated,service_role;

create function public.auto_disable_available_now_session(p_session_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise insufficient_privilege using message='forbidden'; end if;
  return private.transition_available_now_session(p_session_id,'check_misses');
end $$;
revoke all on function public.auto_disable_available_now_session(uuid) from public,anon,authenticated;
grant execute on function public.auto_disable_available_now_session(uuid) to service_role;

-- Preserve P2-T01 activation/location/role policy; route stop through the shared transition.
create or replace function public.manage_available_now_session(p_user_id uuid,p_operation text,p_input jsonb)
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
    perform private.transition_available_now_session(s.id,'manually_disabled',p_user_id);
    return jsonb_build_object('id',s.id,'status','manually_disabled');
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

commit;
