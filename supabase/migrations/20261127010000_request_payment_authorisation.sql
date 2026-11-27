-- P3-T01. The request is the payment identity before a booking exists.
begin;

alter table public.payments
  alter column booking_id drop not null,
  add column booking_request_id uuid unique references public.booking_requests(id) on delete restrict,
  add column commission_cents integer,
  add column barber_net_cents integer,
  add column stripe_payment_intent_id text unique,
  add column authorisation_expires_at timestamptz,
  add column authorisation_release_reason text
    check (authorisation_release_reason in ('request_not_pending', 'authorisation_window_unavailable')),
  add constraint payment_has_parent check (booking_id is not null or booking_request_id is not null),
  add constraint request_payment_amounts check (
    booking_request_id is null or (
      commission_cents is not null and commission_cents >= 0
      and barber_net_cents is not null and barber_net_cents >= 0
      and commission_cents::bigint + barber_net_cents = gross_cents and gross_cents > 0
      and refunded_cents between 0 and gross_cents
    )
  ),
  add constraint request_payment_has_authorisation check (
    booking_request_id is null or status <> 'authorised' or (
      stripe_payment_intent_id is not null and authorisation_expires_at is not null
      and isfinite(authorisation_expires_at) and authorisation_release_reason is null
    )
  );

-- A short, service-only transaction for every local step. The service calls
-- Stripe between transactions. Request then payment is the only lock order.
create function public.request_payment_authorisation(
  p_client_id uuid, p_request_id uuid, p_step text,
  p_stripe_intent_id text default null, p_capture_before timestamptz default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target record;
  payment public.payments;
  snapshot record;
  eligible boolean;
  release_reason text;
  previous_status public.payment_status;
  audit_action text;
begin
  if auth.role() is distinct from 'service_role' then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  if p_step is null or p_step not in ('prepare', 'read', 'bind', 'record', 'release', 'cancelled') then
    raise invalid_parameter_value;
  end if;

  select id, status, expires_at into target
    from public.booking_requests
    where id = p_request_id and client_id = p_client_id
      and exists (select 1 from public.profiles where id = p_client_id and role = 'client')
    for update;
  if not found then raise insufficient_privilege using message = 'forbidden'; end if;
  eligible := target.status = 'pending' and target.expires_at is not null
    and not private.booking_request_deadline_reached(target.expires_at, clock_timestamp());

  select * into payment from public.payments where booking_request_id = target.id for update;
  if not found then
    if not eligible then raise sqlstate 'PT409' using message = 'request_not_pending'; end if;
    if p_step = 'read' then return null; end if;
    if p_step <> 'prepare' then raise invalid_parameter_value; end if;
    select gross_cents, commission_cents, barber_net_cents into snapshot
      from private.booking_request_snapshots where request_id = target.id;
    if not found then raise sqlstate 'PT409' using message = 'request_not_pending'; end if;
    insert into public.payments(booking_request_id,status,gross_cents,commission_cents,barber_net_cents,refunded_cents)
      values(target.id,'requires_authorisation',snapshot.gross_cents,snapshot.commission_cents,snapshot.barber_net_cents,0)
      returning * into payment;
    audit_action := 'payment.authorisation_prepared';
  else
    previous_status := payment.status;
  end if;

  if p_step in ('bind', 'record', 'release', 'cancelled') and (
    p_stripe_intent_id is null or p_stripe_intent_id !~ '^pi_[A-Za-z0-9]+$'
    or (p_step <> 'bind' and payment.stripe_payment_intent_id is distinct from p_stripe_intent_id)
  ) then raise invalid_parameter_value; end if;

  if p_step = 'bind' and payment.stripe_payment_intent_id is distinct from p_stripe_intent_id then
    if payment.stripe_payment_intent_id is not null or payment.status <> 'requires_authorisation' then
      raise invalid_parameter_value;
    end if;
    update public.payments set stripe_payment_intent_id = p_stripe_intent_id
      where id = payment.id returning * into payment;
  end if;

  if p_step in ('record','release') and payment.status = 'requires_authorisation'
    and payment.authorisation_release_reason is null
  then
    release_reason := case
      when not eligible then 'request_not_pending'
      when p_step = 'record' and (
        p_capture_before is null or not isfinite(p_capture_before) or p_capture_before < target.expires_at
      ) then 'authorisation_window_unavailable'
    end;
    if release_reason is not null then
      update public.payments set authorisation_release_reason = release_reason
        where id = payment.id returning * into payment;
      audit_action := 'payment.authorisation_release_required';
    elsif p_step = 'record' then
      update public.payments set status = 'authorised', authorisation_expires_at = p_capture_before
        where id = payment.id returning * into payment;
      audit_action := 'payment.authorised';
    end if;
  elsif p_step = 'cancelled' and payment.status = 'requires_authorisation' then
    update public.payments set status = 'authorisation_cancelled'
      where id = payment.id returning * into payment;
    audit_action := 'payment.authorisation_cancelled';
  end if;

  if audit_action is not null then
    insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,previous_value,new_value,reason)
      values(p_client_id,'client',audit_action,'payments',payment.id,
        case when previous_status is not null then jsonb_build_object('status',previous_status) end,
        jsonb_build_object('status',payment.status), payment.authorisation_release_reason);
  end if;
  return jsonb_build_object('paymentId',payment.id,'eligible',eligible,'status',payment.status,
    'amountCents',payment.gross_cents,'intentId',payment.stripe_payment_intent_id,
    'authorisationExpiresAt',payment.authorisation_expires_at,'releaseReason',payment.authorisation_release_reason);
end;
$$;
revoke all on function public.request_payment_authorisation(uuid,uuid,text,text,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.request_payment_authorisation(uuid,uuid,text,text,timestamptz) to service_role;

commit;
