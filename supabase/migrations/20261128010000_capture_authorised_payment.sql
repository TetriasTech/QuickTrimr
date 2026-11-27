-- P3-T02. One durable capture of the request-bound Stripe authorisation.
begin;

alter table public.payments
  add column stripe_charge_id text unique,
  add column stripe_balance_transaction_id text unique,
  add column processing_fee_cents integer check (processing_fee_cents >= 0),
  add column capture_failure_reason text
    check (capture_failure_reason in ('capture_failed', 'authorisation_expired')),
  add constraint payment_provider_fee_pair check (
    (stripe_balance_transaction_id is null) = (processing_fee_cents is null)
  );

create table private.payment_capture_events (
  payment_id uuid not null references public.payments(id) on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  outcome public.payment_status not null check (outcome in ('captured', 'capture_failed')),
  created_at timestamptz not null default now(),
  primary key (payment_id, outcome)
);
alter table private.payment_capture_events enable row level security;
revoke all on private.payment_capture_events from public, anon, authenticated, service_role;
create index payment_capture_events_booking_idx
  on private.payment_capture_events (booking_id, created_at desc, payment_id, outcome);
create trigger reject_append_only_mutation before update or delete on private.payment_capture_events
  for each row execute function private.reject_append_only_mutation();
create trigger reject_append_only_truncate before truncate on private.payment_capture_events
  for each statement execute function private.reject_append_only_mutation();

-- The caller finishes this transaction before talking to Stripe. Lock order is
-- request, booking, payment. Replay reads and finalizes the same operation.
create function public.capture_authorised_payment(
  p_payment_id uuid, p_step text, p_intent_id text default null,
  p_captured_cents integer default null, p_charge_id text default null,
  p_balance_transaction_id text default null, p_fee_cents integer default null,
  p_failure_reason text default null
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
  expired := payment.authorisation_expires_at <= clock_timestamp();

  if prior = 'captured' or prior = 'capture_failed' then
    -- An already completed operation returns its own outcome, even if the
    -- booking advanced after it was confirmed.
    null;
  elsif booking.status <> 'accepted_pending_payment' then
    raise sqlstate 'PT409' using message = 'invalid_status_transition';
  elsif p_step = 'begin' then
    if prior = 'authorised' then
      if expired then raise sqlstate 'PT409' using message = 'authorisation_expired'; end if;
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
      values (payment.id, booking.id, payment.status);
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
    'expired', expired, 'failureReason', payment.capture_failure_reason, 'idempotent', prior = 'captured'
  );
end;
$$;
revoke all on function public.capture_authorised_payment(uuid,text,text,integer,text,text,integer,text)
  from public, anon, authenticated, service_role;
grant execute on function public.capture_authorised_payment(uuid,text,text,integer,text,text,integer,text)
  to service_role;

create function private.booking_capture_notice(p_booking_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('captureNotice', e.outcome)
    from private.payment_capture_events e where e.booking_id = p_booking_id
    order by e.created_at desc, e.payment_id, e.outcome limit 1
$$;
revoke all on function private.booking_capture_notice(uuid)
  from public, anon, authenticated, service_role;

-- Keep the existing client selection/fallback contract and add a notice only
-- to a selected request owned by the verified client.
alter function public.get_client_booking_request(uuid,boolean) set schema private;
revoke all on function private.get_client_booking_request(uuid,boolean)
  from public, anon, authenticated, service_role;
create function public.get_client_booking_request(
  p_request_id uuid default null, p_active_available_now boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb := private.get_client_booking_request(p_request_id, p_active_available_now);
  notice jsonb;
begin
  if result is null or result->>'status' <> 'accepted' then return result; end if;
  select private.booking_capture_notice(b.id) into notice from public.bookings b
    where b.request_id = (result->>'id')::uuid and b.client_id = auth.uid();
  return result || coalesce(notice, '{}'::jsonb);
end;
$$;

create function public.get_barber_booking_status(p_booking_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', b.id, 'status', b.status)
    || coalesce(private.booking_capture_notice(b.id), '{}'::jsonb)
  from public.bookings b
  where b.id = p_booking_id and b.barber_id = auth.uid()
    and private.current_user_role() = 'barber'
$$;
revoke all on function public.get_client_booking_request(uuid,boolean),
  public.get_barber_booking_status(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_client_booking_request(uuid,boolean),
  public.get_barber_booking_status(uuid) to authenticated;

commit;
