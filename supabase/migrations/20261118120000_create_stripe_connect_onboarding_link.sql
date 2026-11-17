-- TRIMR-37 / P1-T07. Persistent account creation intent and private settlement identity.
begin;

create table private.stripe_connect_accounts (
  barber_id uuid primary key references public.barber_profiles(id) on delete restrict,
  platform_account_id text not null check (platform_account_id ~ '^acct_[A-Za-z0-9]+$'),
  operation_id uuid not null unique default gen_random_uuid(),
  reserved_at timestamptz not null default clock_timestamp(),
  stripe_account_id text unique check (
    stripe_account_id ~ '^acct_[A-Za-z0-9]+$' and stripe_account_id <> platform_account_id
  )
);

alter table private.stripe_connect_accounts enable row level security;
revoke all on private.stripe_connect_accounts from public, anon, authenticated;
grant select, insert, update on private.stripe_connect_accounts to service_role;

create function public.reserve_stripe_connect_account(p_user_id uuid, p_platform text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  intent private.stripe_connect_accounts;
begin
  if not exists (select 1 from public.profiles where id = p_user_id and role = 'barber') then
    raise insufficient_privilege using message = 'stripe_connect_forbidden';
  end if;

  insert into private.stripe_connect_accounts (barber_id, platform_account_id)
    values (p_user_id, p_platform) on conflict (barber_id) do nothing;

  select * into strict intent from private.stripe_connect_accounts where barber_id = p_user_id;
  return jsonb_build_object(
    'platformAccountId', intent.platform_account_id,
    'operationId', intent.operation_id,
    'reservedAt', intent.reserved_at,
    'stripeAccountId', intent.stripe_account_id
  );
end;
$$;

create function public.record_stripe_connect_account(
  p_user_id uuid, p_operation_id uuid, p_account_id text
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  saved_account_id text;
begin
  -- Serialize only the database write and audit. No transaction spans Stripe I/O.
  select stripe_account_id into strict saved_account_id
    from private.stripe_connect_accounts
    where barber_id = p_user_id and operation_id = p_operation_id for update;

  if p_account_id is null then
    raise invalid_parameter_value using message = 'stripe_account_id_required';
  elsif saved_account_id is null then
    update private.stripe_connect_accounts set stripe_account_id = p_account_id
      where barber_id = p_user_id;
    insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id)
      values (p_user_id, 'barber', 'stripe.connect_account_created', 'barber_profiles', p_user_id);
  elsif saved_account_id <> p_account_id then
    raise unique_violation using message = 'stripe_connect_identity_conflict';
  end if;
end;
$$;

create function public.audit_stripe_connect_link(p_user_id uuid, p_account_id text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from private.stripe_connect_accounts a join public.profiles p on p.id = a.barber_id
    where a.barber_id = p_user_id and p.role = 'barber' and a.stripe_account_id = p_account_id
  ) then
    raise insufficient_privilege using message = 'stripe_connect_forbidden';
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id)
    values (p_user_id, 'barber', 'stripe.connect_onboarding_link_issued', 'barber_profiles', p_user_id);
end;
$$;

revoke all on function public.reserve_stripe_connect_account(uuid, text),
  public.record_stripe_connect_account(uuid, uuid, text),
  public.audit_stripe_connect_link(uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_stripe_connect_account(uuid, text),
  public.record_stripe_connect_account(uuid, uuid, text),
  public.audit_stripe_connect_link(uuid, text) to service_role;

commit;
