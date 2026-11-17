-- TRIMR-39 / P1-T09. Provider facts, short refresh leases and atomic event receipts.
begin;
alter table private.stripe_connect_accounts
  add column account_status public.verification_status not null default 'not_started',
  add column charges_enabled boolean not null default false,
  add column payouts_enabled boolean not null default false,
  add column details_submitted boolean not null default false,
  add column ever_verified boolean not null default false,
  add column checked_at timestamptz,
  add column refresh_token uuid,
  add column refresh_until timestamptz,
  add column refresh_actor uuid,
  add column refresh_event_id text,
  add column refresh_event_type text;

create table private.stripe_webhook_events (
  platform_account_id text not null,
  event_id text not null check (event_id ~ '^evt_[A-Za-z0-9_]+$'),
  event_type text not null,
  stripe_account_id text not null check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  processed_at timestamptz not null default clock_timestamp(),
  primary key (platform_account_id, event_id)
);
alter table private.stripe_webhook_events enable row level security;
revoke all on private.stripe_webhook_events from public, anon, authenticated, service_role;
grant select, insert on private.stripe_webhook_events to service_role;
create trigger reject_append_only_mutation before update or delete on private.stripe_webhook_events
  for each row execute function private.reject_append_only_mutation();
create trigger reject_append_only_truncate before truncate on private.stripe_webhook_events
  for each statement execute function private.reject_append_only_mutation();

-- This projection is the Connect gate consumed by future discovery/request/payout queries.
create view private.connect_eligible_barbers with (security_barrier = true) as
  select a.barber_id from private.stripe_connect_accounts a
  join public.profiles p on p.id = a.barber_id
  where p.role = 'barber' and p.verification_status = 'verified'
    and a.account_status = 'verified' and a.charges_enabled and a.payouts_enabled;
revoke all on private.connect_eligible_barbers from public, anon, authenticated;
grant select on private.connect_eligible_barbers to service_role;

create function public.begin_stripe_connect_refresh(
  p_platform text, p_user_id uuid default null, p_account_id text default null,
  p_event_id text default null, p_event_type text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  a private.stripe_connect_accounts;
  token uuid;
begin
  if p_user_id is not null then
    if p_account_id is not null or p_event_id is not null or p_event_type is not null or not exists (
      select 1 from public.profiles where id = p_user_id and role = 'barber'
    ) then raise insufficient_privilege using message = 'stripe_connect_forbidden'; end if;
    select * into a from private.stripe_connect_accounts
      where barber_id = p_user_id for update;
    if not found or a.stripe_account_id is null then return jsonb_build_object('unlinked', true); end if;
    if a.platform_account_id <> p_platform then
      raise invalid_parameter_value using message = 'stripe_connect_platform_mismatch';
    end if;
  else
    if p_account_id is null or p_event_id is null or p_event_type is null then
      raise invalid_parameter_value using message = 'stripe_connect_event_required';
    end if;
    if exists (select 1 from private.stripe_webhook_events
      where platform_account_id = p_platform and event_id = p_event_id) then
      return jsonb_build_object('duplicate', true);
    end if;
    select * into a from private.stripe_connect_accounts
      where platform_account_id = p_platform and stripe_account_id = p_account_id for update;
    -- Foreign/unregistered accounts never acquire an application profile or eligibility.
    if not found then return jsonb_build_object('ignored', true); end if;
    -- Check again after the lock: another request may have just committed this event.
    if exists (select 1 from private.stripe_webhook_events
      where platform_account_id = p_platform and event_id = p_event_id) then
      return jsonb_build_object('duplicate', true);
    end if;
  end if;

  if a.refresh_until > clock_timestamp() then return jsonb_build_object('busy', true); end if;
  token := gen_random_uuid();
  -- Technical lease exceeds the endpoint's bounded provider/database request budget.
  -- Expiration is decided by PostgreSQL and an old holder cannot commit after expiry.
  update private.stripe_connect_accounts set refresh_token = token,
    refresh_until = clock_timestamp() + interval '15 seconds', refresh_actor = p_user_id,
    refresh_event_id = p_event_id, refresh_event_type = p_event_type
    where barber_id = a.barber_id;
  return jsonb_build_object('accountId', a.stripe_account_id, 'token', token,
    'previouslyVerified', a.ever_verified);
end;
$$;

create function public.finish_stripe_connect_refresh(
  p_platform text, p_account_id text, p_token uuid, p_state jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  a private.stripe_connect_accounts;
  previous_state jsonb;
  next_status public.verification_status := (p_state->>'accountStatus')::public.verification_status;
  charges boolean := (p_state->>'chargesEnabled')::boolean;
  payouts boolean := (p_state->>'payoutsEnabled')::boolean;
  submitted boolean := (p_state->>'detailsSubmitted')::boolean;
begin
  select * into strict a from private.stripe_connect_accounts where
    platform_account_id = p_platform and stripe_account_id = p_account_id for update;
  if a.refresh_token is distinct from p_token or a.refresh_until <= clock_timestamp() then
    raise exception using errcode = 'PT409', message = 'stripe_connect_refresh_expired';
  end if;
  if next_status is null or charges is null or payouts is null or submitted is null
    or next_status = 'not_started' or (next_status = 'verified' and not (charges and payouts)) then
    raise invalid_parameter_value using message = 'stripe_connect_invalid_projection';
  end if;
  previous_state := jsonb_build_object('accountStatus', a.account_status,
    'chargesEnabled', a.charges_enabled, 'payoutsEnabled', a.payouts_enabled,
    'detailsSubmitted', a.details_submitted);

  update private.stripe_connect_accounts set account_status = next_status,
    charges_enabled = charges, payouts_enabled = payouts, details_submitted = submitted,
    checked_at = clock_timestamp(), ever_verified = ever_verified or next_status = 'verified',
    refresh_token = null, refresh_until = null, refresh_actor = null,
    refresh_event_id = null, refresh_event_type = null
    where barber_id = a.barber_id;
  update public.profiles set verification_status = next_status
    where id = a.barber_id and role = 'barber' and verification_status is distinct from next_status;

  if previous_state <> p_state then
    insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id,
      previous_value, new_value, metadata)
    values (a.refresh_actor, case when a.refresh_actor is null then null else 'barber'::public.user_role end,
      'stripe.connect_status_changed', 'barber_profiles', a.barber_id, previous_state, p_state,
      jsonb_build_object('source', case when a.refresh_actor is null then 'webhook' else 'refresh' end,
        'actionRequired', a.account_status = 'verified' and next_status <> 'verified'));
  end if;
  if a.refresh_event_id is not null then
    insert into private.stripe_webhook_events (platform_account_id, event_id, event_type, stripe_account_id)
      values (p_platform, a.refresh_event_id, a.refresh_event_type, p_account_id);
  end if;
  return p_state;
end;
$$;

create function public.release_stripe_connect_refresh(p_platform text, p_account_id text, p_token uuid)
returns void language sql security invoker set search_path = '' as $$
  update private.stripe_connect_accounts set refresh_token = null, refresh_until = null,
    refresh_actor = null, refresh_event_id = null, refresh_event_type = null
  where platform_account_id = p_platform and stripe_account_id = p_account_id and refresh_token = p_token;
$$;

revoke all on function public.begin_stripe_connect_refresh(text, uuid, text, text, text),
  public.finish_stripe_connect_refresh(text, text, uuid, jsonb),
  public.release_stripe_connect_refresh(text, text, uuid) from public, anon, authenticated;
grant execute on function public.begin_stripe_connect_refresh(text, uuid, text, text, text),
  public.finish_stripe_connect_refresh(text, text, uuid, jsonb),
  public.release_stripe_connect_refresh(text, text, uuid) to service_role;
commit;
