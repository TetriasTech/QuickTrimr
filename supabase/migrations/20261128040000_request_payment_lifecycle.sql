-- P3-T06. Provider calls always run after the request or payment transaction.
begin;

insert into private.platform_config(key,value) values
  ('accepted_payment_recovery_window','{"available_now_minutes":5,"scheduled_hours":2}');

alter table public.payments
  add column request_authorised_at timestamptz,
  add column lifecycle_due_at timestamptz,
  add column recovery_deadline timestamptz,
  add column capture_attempt integer not null default 0 check (capture_attempt >= 0);

create table private.retired_request_payment_intents (
  payment_id uuid primary key references public.payments(id) on delete restrict,
  stripe_intent_id text not null unique,
  released_at timestamptz not null default clock_timestamp()
);
alter table private.retired_request_payment_intents enable row level security;
revoke all on private.retired_request_payment_intents from public,anon,authenticated,service_role;
create trigger reject_append_only_mutation before update or delete on private.retired_request_payment_intents
  for each row execute function private.reject_append_only_mutation();
create trigger reject_append_only_truncate before truncate on private.retired_request_payment_intents
  for each statement execute function private.reject_append_only_mutation();

create function private.accepted_payment_recovery_deadline(
  kind public.booking_type, failed_at timestamptz, scheduled_for timestamptz, config jsonb
) returns timestamptz language sql immutable set search_path = '' as $$
  select case kind
    when 'available_now' then failed_at + make_interval(mins => (config->>'available_now_minutes')::integer)
    else least(failed_at + make_interval(hours => (config->>'scheduled_hours')::integer), scheduled_for)
  end
$$;
revoke all on function private.accepted_payment_recovery_deadline(public.booking_type,timestamptz,timestamptz,jsonb)
  from public,anon,authenticated,service_role;

update public.payments p
  set request_authorised_at = case when p.status in ('authorised','capture_pending','captured',
    'capture_failed','partially_refunded','refunded','disputed') then p.created_at end,
    lifecycle_due_at = case when r.status in ('declined','expired','cancelled')
        and p.status in ('requires_authorisation','authorised')
      or r.status = 'accepted' and p.status in ('authorised','capture_pending')
      then clock_timestamp() end
  from public.booking_requests r where r.id = p.booking_request_id;

with failed_captures as (
  select p.id, private.accepted_payment_recovery_deadline(
    r.booking_type,event.created_at,r.scheduled_for,cfg.value
  ) as deadline
  from public.payments p
  join public.booking_requests r on r.id=p.booking_request_id and r.status='accepted'
  join public.bookings b on b.id=p.booking_id and b.status='accepted_pending_payment'
  join private.payment_capture_events event on event.payment_id=p.id and event.outcome='capture_failed'
  cross join private.platform_config cfg
  where p.status='capture_failed' and cfg.key='accepted_payment_recovery_window'
)
update public.payments p set recovery_deadline=f.deadline,lifecycle_due_at=f.deadline
  from failed_captures f where f.id=p.id;
create index request_payment_work_due_idx on public.payments(lifecycle_due_at,id)
  where lifecycle_due_at is not null;

-- Privileged only in the direct read policy; recheck the same barber inside
-- the helper so calling it cannot inspect a different customer's draft.
create function private.barber_request_is_submitted(p_request_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select from public.booking_requests r join public.payments p on p.booking_request_id = r.id
    where r.id = p_request_id and r.barber_id = auth.uid() and p.request_authorised_at is not null
      and (r.status <> 'pending' or p.status = 'authorised')
  )
$$;
revoke all on function private.barber_request_is_submitted(uuid) from public,anon,authenticated,service_role;
grant execute on function private.barber_request_is_submitted(uuid) to authenticated;

alter policy own_request_read on public.booking_requests using (
  case (select private.current_user_role())
    when 'client' then client_id = (select auth.uid())
    when 'barber' then barber_id = (select auth.uid()) and private.barber_request_is_submitted(id)
    else false end
);

create function private.guard_request_payment_transition() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'accepted' then
    perform from public.payments p where p.booking_request_id = old.id
      and p.status = 'authorised' and p.request_authorised_at is not null
      and p.authorisation_expires_at > clock_timestamp() for update;
    if not found then raise sqlstate 'PT409' using message = 'request_not_pending'; end if;
  end if;
  return new;
end
$$;
create trigger guard_request_payment_transition before update of status on public.booking_requests
  for each row when (old.status is distinct from new.status)
  execute function private.guard_request_payment_transition();

create function private.schedule_request_payment_transition() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.payments set lifecycle_due_at = clock_timestamp()
    where booking_request_id = new.id and status in ('requires_authorisation','authorised');
  return new;
end
$$;
create trigger schedule_request_payment_transition after update of status on public.booking_requests
  for each row when (old.status is distinct from new.status
    and new.status in ('accepted','declined','expired','cancelled'))
  execute function private.schedule_request_payment_transition();

create function private.set_request_payment_work() returns trigger
language plpgsql set search_path = '' as $$
declare
  request public.booking_requests;
  config jsonb;
begin
  if new.booking_request_id is null or new.status is not distinct from old.status then return new; end if;
  select * into request from public.booking_requests where id = new.booking_request_id;
  case new.status
    when 'authorised' then
      new.request_authorised_at := coalesce(old.request_authorised_at,clock_timestamp());
      new.lifecycle_due_at := case when request.status = 'accepted' then clock_timestamp() end;
    when 'capture_failed' then
      if old.recovery_deadline is null then
        select value into strict config from private.platform_config where key = 'accepted_payment_recovery_window';
        new.recovery_deadline := private.accepted_payment_recovery_deadline(
          request.booking_type,clock_timestamp(),request.scheduled_for,config
        );
      end if;
      new.lifecycle_due_at := new.recovery_deadline;
    when 'captured', 'authorisation_cancelled', 'refunded', 'partially_refunded', 'disputed' then
      new.lifecycle_due_at := null;
    else null;
  end case;
  return new;
end
$$;
create trigger set_request_payment_work before update of status on public.payments
  for each row execute function private.set_request_payment_work();

revoke all on function private.guard_request_payment_transition(), private.schedule_request_payment_transition(),
  private.set_request_payment_work() from public,anon,authenticated,service_role;

create or replace function private.barber_inbox_page(
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
  join public.payments p on p.booking_request_id = r.id and p.status = 'authorised'
    and p.request_authorised_at is not null and p.authorisation_expires_at > p_now
  where r.barber_id = p_barber_id and r.status = 'pending' and r.expires_at > p_now
    and (p_request_id is null or r.id = p_request_id)
    and (r.expires_at, r.id) > (
      coalesce(p_after_expires_at, '-infinity'::timestamptz),
      coalesce(p_after_request_id, '00000000-0000-0000-0000-000000000000'::uuid)
    )
  order by r.expires_at, r.id
  limit p_probe_limit;
$$;

create or replace function private.expire_booking_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target record; server_now timestamptz;
begin
  -- Match accept/decline and session writers. The barber on a request is immutable.
  perform 1 from public.profiles
    where id = (select barber_id from public.booking_requests where id = p_request_id)
    for update;
  select id, status, expires_at, booking_type into target
    from public.booking_requests where id = p_request_id for update;
  if not found then raise sqlstate 'PT404' using message = 'not_found'; end if;

  server_now := clock_timestamp();
  update public.booking_requests set status = 'expired'
    where id = target.id and status = 'pending'
    and private.booking_request_deadline_reached(expires_at, server_now);
  if not found then
    return jsonb_build_object('requestId', target.id, 'applied', false, 'status', target.status);
  end if;

  if target.booking_type = 'available_now' and exists (
    select from public.payments where booking_request_id = target.id and request_authorised_at is not null
  ) then
    perform private.record_available_now_request_outcome(target.id, 'expired');
  end if;
  -- The request ID plus this audit action identifies the durable expiry outcome.
  -- P3-T06 consumes it for authorization release outside this transaction.
  insert into public.audit_logs(action, entity_type, entity_id, previous_value, new_value,
    reason, metadata, created_at, updated_at)
  values ('booking_request.expired', 'booking_requests', target.id,
    jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'expired'),
    'The server request deadline elapsed.',
    jsonb_build_object('bookingType', target.booking_type, 'expiresAt', target.expires_at),
    server_now, server_now);
  return jsonb_build_object('requestId', target.id, 'applied', true, 'status', 'expired');
end;
$$;

create or replace function public.decline_booking_request(
  p_barber_id uuid, p_request_id uuid, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target record;
  server_now timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  -- Mirror the shared reason codes at the trusted write boundary so even a
  -- service caller cannot put arbitrary text into the append-only audit.
  if p_reason is not null and p_reason not in ('too_far','unavailable','service_unavailable','other') then
    raise sqlstate 'PT422' using message = 'invalid_decline_reason';
  end if;

  -- Serialize with acceptance and session writers before locking the request.
  perform 1 from public.profiles where id = p_barber_id and role = 'barber' for update;
  if not found then raise insufficient_privilege using message = 'forbidden'; end if;
  select id, status, booking_type, expires_at into target from public.booking_requests
    where id = p_request_id and barber_id = p_barber_id for update;
  if not found then raise insufficient_privilege using message = 'forbidden'; end if;

  server_now := clock_timestamp();
  if target.status <> 'pending' or target.expires_at is null
    or private.booking_request_deadline_reached(target.expires_at, server_now)
    or not exists (select from public.payments where booking_request_id = target.id
      and request_authorised_at is not null)
  then
    raise sqlstate 'PT409' using message = 'request_not_pending';
  end if;
  update public.booking_requests set status = 'declined'
    where id = target.id and status = 'pending';
  if not found then raise sqlstate 'PT409' using message = 'request_not_pending'; end if;

  if target.booking_type = 'available_now' then
    perform private.record_available_now_request_outcome(target.id, 'declined');
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id,
    previous_value, new_value, reason, metadata, created_at, updated_at)
    values (p_barber_id, 'barber', 'booking_request.declined', 'booking_requests', target.id,
      jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'declined'),
      'Barber declined the booking request.',
      jsonb_strip_nulls(jsonb_build_object('bookingType', target.booking_type, 'declineReason', p_reason)),
      server_now, server_now);

  return jsonb_build_object('requestId', target.id, 'status', 'declined');
end;
$$;

-- Replace the RPC signature without leaving ambiguous default-argument overloads.
drop function public.capture_authorised_payment(uuid,text,text,integer,text,text,integer,text);
create function public.capture_authorised_payment(
  p_payment_id uuid, p_step text, p_intent_id text default null,
  p_captured_cents integer default null, p_charge_id text default null,
  p_balance_transaction_id text default null, p_fee_cents integer default null,
  p_failure_reason text default null, p_capture_attempt integer default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target_request_id uuid;
  booking public.bookings;
  payment public.payments;
  prior public.payment_status;
  expired boolean;
  event_action text;
begin
  if auth.role() is distinct from 'service_role' then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  if p_payment_id is null then return null; end if; -- authorization probe
  if p_step is null or p_step not in ('begin', 'complete', 'fail') then
    raise invalid_parameter_value;
  end if;

  select booking_request_id into target_request_id from public.payments where id = p_payment_id;
  if not found then raise sqlstate 'PT404' using message = 'not_found'; end if;
  perform 1 from public.booking_requests r where r.id = target_request_id and r.status = 'accepted' for update;
  if not found then raise sqlstate 'PT409' using message = 'invalid_status_transition'; end if;
  select b.* into booking from public.bookings b where b.request_id = target_request_id for update;
  if not found then raise sqlstate 'PT409' using message = 'invalid_status_transition'; end if;
  select p.* into payment from public.payments p
    where p.id = p_payment_id and p.booking_request_id = target_request_id for update;
  if not found or (payment.booking_id is not null and payment.booking_id <> booking.id)
    or payment.gross_cents is distinct from booking.gross_cents
    or payment.commission_cents is distinct from booking.commission_cents
    or payment.barber_net_cents is distinct from booking.barber_net_cents
    or payment.stripe_payment_intent_id is null or payment.authorisation_expires_at is null
    or not isfinite(payment.authorisation_expires_at)
    or payment.authorisation_release_reason is not null
  then raise sqlstate 'PT409' using message = 'invalid_status_transition'; end if;
  prior := payment.status;
  expired := payment.authorisation_expires_at <= clock_timestamp()
    or coalesce(payment.recovery_deadline <= clock_timestamp(), false);
  if p_capture_attempt is not null and p_capture_attempt <> payment.capture_attempt then
    raise sqlstate 'PT409' using message = 'invalid_status_transition';
  end if;

  if prior = 'captured' or prior = 'capture_failed' then
    -- An already completed operation returns its own outcome, even if the
    -- booking advanced after it was confirmed.
    null;
  elsif booking.status <> 'accepted_pending_payment' then
    raise sqlstate 'PT409' using message = 'invalid_status_transition';
  elsif p_step = 'begin' then
    if prior = 'authorised' then
      update public.payments set booking_id = booking.id, status = 'capture_pending'
        where id = payment.id returning * into payment;
      event_action := 'payment.capture_started';
    elsif prior <> 'capture_pending' then
      raise sqlstate 'PT409' using message = 'invalid_status_transition';
    end if;
  else
    if prior <> 'capture_pending' or payment.booking_id is distinct from booking.id
      or p_intent_id is distinct from payment.stripe_payment_intent_id
    then raise sqlstate 'PT409' using message = 'invalid_status_transition'; end if;
    if p_step = 'complete' then
      if p_captured_cents is distinct from payment.gross_cents or p_charge_id is null
        or p_charge_id !~ '^ch_[A-Za-z0-9]+$'
        or (p_balance_transaction_id is not null and p_balance_transaction_id !~ '^txn_[A-Za-z0-9]+$')
        or (p_balance_transaction_id is null) <> (p_fee_cents is null)
      then raise invalid_parameter_value; end if;
      update public.payments set status = 'captured', stripe_charge_id = p_charge_id,
        stripe_balance_transaction_id = p_balance_transaction_id, processing_fee_cents = p_fee_cents
        where id = payment.id returning * into payment;
      update public.bookings set status = 'paid_confirmed' where id = booking.id;
      insert into public.booking_status_history(booking_id, from_status, to_status, reason)
        values (booking.id, booking.status, 'paid_confirmed', 'Stripe verified the full capture.');
      event_action := 'payment.captured';
    else
      if p_failure_reason is null or p_failure_reason not in ('capture_failed', 'authorisation_expired') then
        raise invalid_parameter_value;
      end if;
      update public.payments set status = 'capture_failed', capture_failure_reason = p_failure_reason
        where id = payment.id returning * into payment;
      event_action := 'payment.capture_failed';
    end if;
    insert into private.payment_capture_events(payment_id, booking_id, outcome)
      values (payment.id, booking.id, payment.status) on conflict (payment_id,outcome) do nothing;
  end if;

  if event_action is not null then
    insert into public.audit_logs(action, entity_type, entity_id, previous_value, new_value, reason)
      values(event_action, 'payments', payment.id, jsonb_build_object('status', prior),
        jsonb_build_object('status', payment.status), event_action);
  end if;
  return jsonb_build_object(
    'paymentId', payment.id, 'requestId', target_request_id, 'intentId', payment.stripe_payment_intent_id,
    'amountCents', payment.gross_cents, 'status', payment.status,
    'authorisationExpiresAt', payment.authorisation_expires_at,
    'expired', expired, 'captureAttempt', payment.capture_attempt, 'failureReason', payment.capture_failure_reason, 'idempotent', prior = 'captured'
  );
end;
$$;
revoke all on function public.capture_authorised_payment(uuid,text,text,integer,text,text,integer,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.capture_authorised_payment(uuid,text,text,integer,text,text,integer,text,integer) to service_role;

create or replace function private.apply_stripe_intent(p_event private.stripe_financial_events,p_fact jsonb) returns text
language plpgsql set search_path='' as $$
declare
  payment public.payments:=private.lock_stripe_financial_payment(p_event.object_id);
  provider_status text:=p_fact->>'status';
begin
  if payment.id is null then
    -- A prior intent is retired only after Stripe proves release and zero capture.
    if provider_status = 'canceled' and exists (
      select from private.retired_request_payment_intents where stripe_intent_id = p_event.object_id
    ) then return 'unchanged'; end if;
    return 'unmapped';
  end if;
  if payment.booking_request_id::text is distinct from p_fact->>'requestId'
    or payment.gross_cents is distinct from (p_fact->>'amountCents')::integer
  then return 'identity_mismatch'; end if;
  if provider_status='succeeded' then
    if payment.gross_cents is distinct from (p_fact->>'receivedCents')::integer
      or p_fact->>'chargeId' is null then return 'identity_mismatch'; end if;
    if payment.status='capture_pending' then
      perform public.capture_authorised_payment(payment.id,'complete',p_event.object_id,payment.gross_cents,
        p_fact->>'chargeId',p_fact->>'balanceTransactionId',(p_fact->>'feeCents')::integer);
      return 'applied';
    end if;
    if payment.status in ('captured','partially_refunded','refunded','disputed')
      and payment.stripe_charge_id=p_fact->>'chargeId' then
      if payment.processing_fee_cents is null and p_fact->>'balanceTransactionId' is not null then
        update public.payments set processing_fee_cents=(p_fact->>'feeCents')::integer,
          stripe_balance_transaction_id=p_fact->>'balanceTransactionId' where id=payment.id;
        insert into public.audit_logs(action,entity_type,entity_id)
          values('payment.stripe_fee_reconciled','payments',payment.id);
        return 'applied';
      end if;
      return 'unchanged';
    end if;
    return 'identity_mismatch';
  end if;
  if payment.status='capture_pending' and payment.capture_attempt=0 and provider_status in ('canceled','requires_payment_method','requires_action') then
    perform public.capture_authorised_payment(p_payment_id=>payment.id,p_step=>'fail',
      p_intent_id=>p_event.object_id,p_failure_reason=>case when payment.authorisation_expires_at<=clock_timestamp()
       then 'authorisation_expired' else 'capture_failed' end);
    return 'applied';
  end if;
  if provider_status='canceled' and payment.status in ('authorised','requires_authorisation') then
    update public.payments set status='authorisation_cancelled' where id=payment.id;
    insert into public.audit_logs(action,entity_type,entity_id,previous_value,new_value)
      values('payment.authorisation_cancelled','payments',payment.id,
        jsonb_build_object('status',payment.status),jsonb_build_object('status','authorisation_cancelled'));
    return 'applied';
  end if;
  return 'unchanged';
end $$;

-- Only the owning client can open the same accepted booking for recovery.
-- All identity swaps are recorded before a new SDK credential can be returned.
create function public.recover_request_payment(
  p_client_id uuid,p_request_id uuid,p_step text,p_stripe_intent_id text default null,
  p_capture_before timestamptz default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  request public.booking_requests;
  booking public.bookings;
  payment public.payments;
  previous_status public.payment_status;
  replacement boolean;
  changed text;
  eligible boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  select r.* into request from public.booking_requests r
    where r.id = p_request_id and r.client_id = p_client_id
      and exists (select from public.profiles where id = p_client_id and role='client')
    for update;
  if not found then raise insufficient_privilege using message = 'forbidden'; end if;
  select * into booking from public.bookings where request_id = request.id for update;
  select * into payment from public.payments where booking_request_id = request.id for update;
  if payment.id is null or payment.booking_id is distinct from booking.id then
    raise sqlstate 'PT409' using message = 'request_not_pending';
  end if;
  previous_status := payment.status;
  eligible := request.status = 'accepted' and booking.status = 'accepted_pending_payment'
    and coalesce(payment.recovery_deadline > clock_timestamp(),false)
    and payment.status in ('capture_failed','requires_authorisation','authorised','capture_pending');
  select exists (select from private.retired_request_payment_intents where payment_id=payment.id)
    into replacement;

  if p_step <> 'read' and not eligible then
    raise sqlstate 'PT409' using message = 'request_not_pending';
  end if;
  case p_step
    when 'read' then null;
    when 'resume' then
      if payment.status = 'capture_failed' and payment.stripe_payment_intent_id = p_stripe_intent_id then
        update public.payments set status='requires_authorisation',authorisation_expires_at=null
          where id=payment.id returning * into payment;
        changed := 'payment.recovery_started';
      end if;
    when 'retire' then
      if payment.status not in ('capture_failed','requires_authorisation')
        or payment.stripe_payment_intent_id is distinct from p_stripe_intent_id
        or p_stripe_intent_id is null
      then raise sqlstate 'PT409' using message = 'request_not_pending'; end if;
      if replacement then
        -- Both intents are preserved. The closed second intent exhausts recovery.
      update public.payments set status='authorisation_cancelled'
          where id=payment.id returning * into payment;
        update public.payments set lifecycle_due_at=clock_timestamp() where id=payment.id;
        eligible := false;
        changed := 'payment.recovery_exhausted';
      else
        insert into private.retired_request_payment_intents(payment_id,stripe_intent_id)
          values(payment.id,p_stripe_intent_id);
        update public.payments set status='requires_authorisation',
          stripe_payment_intent_id=null,authorisation_expires_at=null
          where id=payment.id returning * into payment;
        replacement := true;
        changed := 'payment.recovery_intent_retired';
      end if;
    when 'bind' then
      if not replacement or payment.status <> 'requires_authorisation'
        or p_stripe_intent_id is null or p_stripe_intent_id !~ '^pi_[A-Za-z0-9]+$'
        or (payment.stripe_payment_intent_id is not null
            and payment.stripe_payment_intent_id <> p_stripe_intent_id)
      then raise sqlstate 'PT409' using message = 'request_not_pending'; end if;
      update public.payments set stripe_payment_intent_id=p_stripe_intent_id
        where id=payment.id returning * into payment;
    when 'record' then
      if payment.stripe_payment_intent_id is distinct from p_stripe_intent_id
        or p_capture_before is null or not isfinite(p_capture_before)
        or p_capture_before <= clock_timestamp()
      then raise sqlstate 'PT409' using message = 'request_not_pending'; end if;
      if payment.status in ('capture_failed','requires_authorisation') then
        update public.payments set status='authorised',authorisation_expires_at=p_capture_before,
          capture_failure_reason=null,capture_attempt=capture_attempt+1
          where id=payment.id returning * into payment;
        changed := 'payment.recovery_authorised';
      end if;
    else raise invalid_parameter_value;
  end case;

  if changed is not null then
    insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,previous_value,new_value)
      values (p_client_id,'client',changed,'payments',payment.id,jsonb_build_object('status',previous_status),
        jsonb_build_object('status',payment.status,'captureAttempt',payment.capture_attempt));
  end if;
  return jsonb_build_object('paymentId',payment.id,'eligible',eligible,'status',payment.status,
    'amountCents',payment.gross_cents,'intentId',payment.stripe_payment_intent_id,
    'authorisationExpiresAt',payment.authorisation_expires_at,'releaseReason',null,
    'replacement',replacement);
end
$$;

-- Claiming postpones the next read temporarily. A dropped caller is retried
-- without depending on application memory, timers, or a second transition.
create function public.claim_request_payment_work(p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  retry_seconds integer := (private.booking_request_expiry_config()->>'reconcileSeconds')::integer;
  config jsonb;
  claimed jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise insufficient_privilege; end if;
  select value into strict config
    from private.platform_config where key='stripe_webhook_worker';
  with due as (
    select p.id from public.payments p
    where p.lifecycle_due_at <= statement_timestamp()
      and (p_request_id is null or p.booking_request_id=p_request_id)
    order by p.lifecycle_due_at,p.id limit (config->>'batchSize')::integer for update skip locked
  ), bumped as (
    update public.payments p set lifecycle_due_at=clock_timestamp()+make_interval(secs=>retry_seconds)
    from due where due.id=p.id returning p.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('paymentId',p.id,'requestId',r.id,'intentId',p.stripe_payment_intent_id,
    'amountCents',p.gross_cents,'action',case when r.status='accepted'
      and p.status in ('authorised','capture_pending') then 'capture' else 'release' end)), '[]'::jsonb)
  into claimed from bumped p join public.booking_requests r on r.id=p.booking_request_id;
  return jsonb_build_object('jobs',claimed,'concurrency',(config->>'concurrency')::integer);
end
$$;

-- Terminal requests cannot return to acceptance. For recovery, a claim for
-- release is valid only once the single recovery window or replacement ends.
create function public.complete_request_payment_release(
  p_payment_id uuid,p_intent_id text,p_released boolean default false
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  request public.booking_requests;
  booking public.bookings;
  payment public.payments;
begin
  if auth.role() is distinct from 'service_role' then raise insufficient_privilege; end if;
  select * into request from public.booking_requests where id=(
    select booking_request_id from public.payments where id=p_payment_id
  ) for update;
  if not found then return false; end if;
  select * into booking from public.bookings where request_id=request.id for update;
  select * into payment from public.payments where id=p_payment_id for update;
  if payment.stripe_payment_intent_id is distinct from p_intent_id
    or payment.status in ('captured','refunded','partially_refunded','disputed','capture_pending')
    or not (request.status in ('declined','expired','cancelled') or (
      request.status='accepted' and booking.status='accepted_pending_payment'
      and (coalesce(payment.recovery_deadline<=clock_timestamp(),false)
        or payment.status='authorisation_cancelled')
    ))
  then return false; end if;
  if not p_released then return true; end if;
  update public.payments set status='authorisation_cancelled',lifecycle_due_at=null where id=payment.id;
  if payment.status <> 'authorisation_cancelled' then
    insert into public.audit_logs(action,entity_type,entity_id,previous_value,new_value)
      values ('payment.authorisation_cancelled','payments',payment.id,
        jsonb_build_object('status',payment.status),jsonb_build_object('status','authorisation_cancelled'));
  end if;
  if request.status='accepted' then
    update public.bookings set status='cancelled' where id=booking.id;
    insert into public.booking_status_history(booking_id,from_status,to_status,reason)
      values (booking.id,booking.status,'cancelled','Payment recovery ended without a capture or an outstanding hold.');
    update public.booking_requests set status='cancelled' where id=request.id;
    insert into public.audit_logs(action,entity_type,entity_id,previous_value,new_value)
      values ('booking.payment_recovery_closed','bookings',booking.id,
        jsonb_build_object('status',booking.status),jsonb_build_object('status','cancelled'));
  end if;
  return true;
end
$$;

-- Payment status for the owning client only. The barber projections retain
-- their existing outcome notices and never receive payment credentials.
create or replace function public.get_client_booking_request(
  p_request_id uuid default null,p_active_available_now boolean default false
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  result jsonb := private.get_client_booking_request(p_request_id,p_active_available_now);
  booking public.bookings;
  payment public.payments;
begin
  if result is null then return null; end if;
  select * into payment from public.payments where booking_request_id=(result->>'id')::uuid;
  if result->>'status'='pending' and payment.request_authorised_at is null then
    return result || jsonb_build_object('paymentRequired',true);
  end if;
  if result->>'status'='accepted' then
    select * into booking from public.bookings where request_id=(result->>'id')::uuid and client_id=auth.uid();
    return result || coalesce(private.booking_capture_notice(booking.id),'{}'::jsonb)
      || case when booking.status='accepted_pending_payment' and payment.recovery_deadline is not null
        then jsonb_build_object('paymentRecoveryDeadline',payment.recovery_deadline)
        else '{}'::jsonb end;
  end if;
  return result;
end
$$;

create function public.cancel_booking_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := private.require_booking_request_client();
  request public.booking_requests;
begin
  select * into request from public.booking_requests where id=p_request_id and client_id=caller for update;
  if not found then raise insufficient_privilege using message='forbidden'; end if;
  if request.status not in ('pending','cancelled') then
    raise sqlstate 'PT409' using message='request_not_pending';
  end if;
  if request.status='pending' then
    update public.booking_requests set status='cancelled' where id=request.id;
    insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,previous_value,new_value)
      values(caller,'client','booking_request.cancelled','booking_requests',request.id,
        jsonb_build_object('status','pending'),jsonb_build_object('status','cancelled'));
  end if;
  return jsonb_build_object('requestId',request.id,'status','cancelled');
end
$$;

revoke all on function public.recover_request_payment(uuid,uuid,text,text,timestamptz),
  public.claim_request_payment_work(uuid),public.complete_request_payment_release(uuid,text,boolean),
  public.cancel_booking_request(uuid) from public,anon,authenticated,service_role;
grant execute on function public.recover_request_payment(uuid,uuid,text,text,timestamptz),
  public.claim_request_payment_work(uuid),public.complete_request_payment_release(uuid,text,boolean) to service_role;
grant execute on function public.cancel_booking_request(uuid) to authenticated;

create or replace function public.create_booking_request(p_client_id uuid, p_input jsonb) returns jsonb
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
  return result || jsonb_build_object('paymentRequired',true);
end;
$$;

commit;
