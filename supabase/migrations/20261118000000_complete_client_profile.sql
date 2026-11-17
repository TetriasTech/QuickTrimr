begin;

alter table public.client_profiles
  add column display_name text check (display_name is null or btrim(display_name) <> ''),
  add column mobile text check (mobile is null or mobile ~ '^\+614[0-9]{8}$'),
  add column avatar_path text;

-- Preserve P0-T11's row policies; only these new columns are readable.
grant select (display_name, mobile, avatar_path) on public.client_profiles to authenticated;

-- The onboarding predicate needs the archive marker before P1-T05 adds address management.
alter table public.client_addresses add column archived_at timestamptz;
grant select (archived_at) on public.client_addresses to authenticated;
create index client_addresses_active_client_idx on public.client_addresses (client_id)
  where archived_at is null;

insert into storage.buckets (id, name, public, allowed_mime_types)
values ('client-avatars', 'client-avatars', false, array['image/jpeg']);

-- One private upload per client. The caller can never select an arbitrary path.
create policy own_client_avatar_read on storage.objects for select to authenticated
  using (
    bucket_id = 'client-avatars'
    and name = (select auth.uid())::text || '/avatar.jpg'
    and owner_id = (select auth.uid())::text
    and (select private.current_user_role()) = 'client'
  );
create policy own_client_avatar_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'client-avatars'
    and name = (select auth.uid())::text || '/avatar.jpg'
    and owner_id = (select auth.uid())::text
    and (select private.current_user_role()) = 'client'
  );
create policy own_client_avatar_replace on storage.objects for update to authenticated
  using (
    bucket_id = 'client-avatars'
    and name = (select auth.uid())::text || '/avatar.jpg'
    and owner_id = (select auth.uid())::text
    and (select private.current_user_role()) = 'client'
  )
  with check (
    bucket_id = 'client-avatars'
    and name = (select auth.uid())::text || '/avatar.jpg'
    and owner_id = (select auth.uid())::text
    and (select private.current_user_role()) = 'client'
  );

create function public.complete_client_profile(
  p_user_id uuid,
  p_display_name text,
  p_mobile text,
  p_attach_avatar boolean
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_role public.user_role;
  verification public.verification_status;
  completed_at timestamptz;
  previous_name text;
  previous_mobile text;
  previous_avatar text;
  saved_avatar text;
  address_ready boolean;
  changed boolean;
begin
  select p.role, p.verification_status, p.onboarding_completed_at
    into owner_role, verification, completed_at
    from public.profiles p where id = p_user_id for update;
  if owner_role is distinct from 'client'::public.user_role then
    raise insufficient_privilege using message = 'client_profile_forbidden';
  end if;

  select display_name, mobile, avatar_path into previous_name, previous_mobile, previous_avatar
  from public.client_profiles where id = p_user_id;
  saved_avatar := previous_avatar;
  if p_attach_avatar then
    saved_avatar := p_user_id::text || '/avatar.jpg';
    if not exists (
      select 1 from storage.objects
      where bucket_id = 'client-avatars' and name = saved_avatar and owner_id = p_user_id::text
    ) then
      raise invalid_parameter_value using message = 'client_avatar_missing';
    end if;
  end if;

  changed := (previous_name, previous_mobile, previous_avatar)
    is distinct from (p_display_name, p_mobile, saved_avatar);
  if changed then
    insert into public.client_profiles (id, display_name, mobile, avatar_path)
    values (p_user_id, p_display_name, p_mobile, saved_avatar)
    on conflict (id) do update set display_name = excluded.display_name,
      mobile = excluded.mobile, avatar_path = excluded.avatar_path;
  end if;

  select exists (
    select 1 from public.client_addresses where client_id = p_user_id and archived_at is null
  ) into address_ready;

  if (completed_at is not null) is distinct from address_ready then
    update public.profiles
    set onboarding_completed_at = case when address_ready then now() else null end
    where id = p_user_id;
    changed := true;
  end if;

  if changed then
    insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, new_value)
    values (p_user_id, owner_role, 'client.profile_saved', 'profile', p_user_id,
      jsonb_build_object('onboardingComplete', address_ready, 'hasAvatar', saved_avatar is not null));
  end if;

  return jsonb_build_object('id', p_user_id, 'displayName', p_display_name, 'mobile', p_mobile,
    'onboardingComplete', address_ready, 'verificationStatus', verification);
end;
$$;

revoke all on function public.complete_client_profile(uuid, text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_client_profile(uuid, text, text, boolean)
  to service_role;

commit;
