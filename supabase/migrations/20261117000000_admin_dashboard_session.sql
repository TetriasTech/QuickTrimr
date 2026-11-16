begin;

-- CFG-ADMIN-SESSION-HOURS. Configuration is private and changes by migration
-- until a separately authorised, audited configuration editor exists.
create table private.platform_config (
  key text primary key,
  value jsonb not null
);
alter table private.platform_config enable row level security;
revoke all on private.platform_config from public, anon, authenticated, service_role;
insert into private.platform_config (key, value) values ('admin_session_hours', '8');

create index audit_logs_admin_session_idx on public.audit_logs (entity_id, actor_id)
  where entity_type = 'admin_session';

create function public.admin_dashboard_session(p_operation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  session_claim text := auth.jwt() ->> 'session_id';
  session_id uuid;
  started_at timestamptz;
  provider_expiry timestamptz;
  session_hours integer;
  was_opened boolean;
  was_closed boolean;
begin
  if p_operation is null or p_operation not in ('open', 'check', 'close') then
    raise invalid_parameter_value using message = 'Invalid admin session operation';
  end if;

  if caller_id is null or not coalesce(pg_input_is_valid(session_claim, 'uuid'), false) then
    return jsonb_build_object('status', 'expired');
  end if;
  session_id := session_claim::uuid;

  -- Serialize changes to one dashboard session without locking Auth-owned rows.
  if p_operation <> 'check' then
    perform pg_advisory_xact_lock(hashtextextended('quicktrimr-admin:' || session_claim, 0));
  end if;

  select s.created_at, s.not_after into started_at, provider_expiry
  from auth.sessions s where s.id = session_id and s.user_id = caller_id;
  if not found or started_at is null or provider_expiry <= clock_timestamp() then
    return jsonb_build_object('status', 'expired');
  end if;
  if private.current_user_role() is distinct from 'admin'::public.user_role then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select coalesce(bool_or(a.action = 'admin.sign_in'), false),
         coalesce(bool_or(a.action = 'admin.sign_out'), false)
  into was_opened, was_closed
  from public.audit_logs a
  where a.entity_type = 'admin_session' and a.entity_id = session_id and a.actor_id = caller_id;

  if was_closed then
    return jsonb_build_object('status', 'expired');
  end if;
  if p_operation = 'close' then
    if was_opened then
      insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id)
      values (caller_id, 'admin', 'admin.sign_out', 'admin_session', session_id);
    end if;
    return jsonb_build_object('status', 'expired');
  end if;

  select (c.value #>> '{}')::integer into session_hours
  from private.platform_config c where c.key = 'admin_session_hours';
  if session_hours is null or session_hours <= 0 then
    raise object_not_in_prerequisite_state using message = 'Admin session policy unavailable';
  end if;
  if clock_timestamp() >= started_at + make_interval(hours => session_hours) then
    return jsonb_build_object('status', 'expired');
  end if;

  if not was_opened then
    if p_operation <> 'open' then
      return jsonb_build_object('status', 'forbidden');
    end if;
    insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id)
    values (caller_id, 'admin', 'admin.sign_in', 'admin_session', session_id);
  end if;
  return jsonb_build_object('status', 'active', 'userId', caller_id);
end;
$$;

revoke all on function public.admin_dashboard_session(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_dashboard_session(text) to authenticated;

commit;
