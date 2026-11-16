-- P1-T03: one atomic server-only write for the profile, subtype, and audit.
begin;

alter table public.profiles add column onboarding_completed_at timestamptz;

create function public.create_or_sync_profile(
  p_user_id uuid,
  p_signup_role public.user_role
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  profile public.profiles%rowtype;
begin
  if p_user_id is null or p_signup_role is null or p_signup_role = 'admin' then
    raise insufficient_privilege using message = 'profile_role_forbidden';
  end if;

  insert into public.profiles (id, role, verification_status)
  values (p_user_id, p_signup_role, 'not_started')
  on conflict (id) do nothing returning * into profile;

  if found then
    if profile.role = 'client' then
      insert into public.client_profiles (id) values (profile.id);
    else
      insert into public.barber_profiles (id) values (profile.id);
    end if;

    insert into public.audit_logs (
      actor_id, actor_role, action, entity_type, entity_id, new_value
    ) values (
      profile.id, profile.role, 'profile.created', 'profile', profile.id,
      jsonb_build_object('role', profile.role, 'verificationStatus', profile.verification_status)
    );
  else
    -- The unique constraint waits for any winning insert to commit. Read the
    -- committed row in a new statement; do not update it on an ordinary sync.
    select * into strict profile from public.profiles where id = p_user_id;
    if profile.role <> p_signup_role then
      raise insufficient_privilege using message = 'profile_role_forbidden';
    end if;
  end if;

  return jsonb_build_object(
    'id', profile.id,
    'role', profile.role,
    'verificationStatus', profile.verification_status,
    'onboardingComplete', profile.onboarding_completed_at is not null,
    'createdAt', profile.created_at
  );
end;
$$;

revoke all on function public.create_or_sync_profile(uuid, public.user_role)
  from public, anon, authenticated, service_role;
grant execute on function public.create_or_sync_profile(uuid, public.user_role)
  to service_role;

commit;
