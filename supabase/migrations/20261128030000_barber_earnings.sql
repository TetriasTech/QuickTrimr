-- P3-T04. Earnings reconcile to captured booking snapshots in one transaction.
begin;

alter table public.barber_earnings
  add column available_at timestamptz;
revoke insert, update, delete, truncate on public.barber_earnings
  from public, anon, authenticated;
alter table private.stripe_refund_mappings
  add column is_cancellation boolean not null default false;
create index barber_earnings_booking_disputes_idx on public.disputes (booking_id, status);

-- Booking -> payment -> earning is the lock order. Capture already holds the
-- booking and payment locks. Release and future booking/dispute writers use
-- the same booking lock before changing any release evidence.
create function private.earning_capture(p_booking public.bookings) returns public.payments
language plpgsql set search_path = '' as $$
declare
  capture public.payments;
begin
  select p.* into capture
    from public.payments p
    join private.payment_capture_events event on event.payment_id = p.id
      and event.booking_id = p_booking.id and event.outcome = 'captured'
    where p.booking_request_id = p_booking.request_id and p.booking_id = p_booking.id
      and p.status in ('captured', 'partially_refunded', 'refunded', 'disputed')
      and p.stripe_charge_id is not null
    for update of p;

  if not found or capture.gross_cents is distinct from p_booking.gross_cents
    or capture.commission_cents is distinct from p_booking.commission_cents
    or capture.barber_net_cents is distinct from p_booking.barber_net_cents
  then
    raise sqlstate 'PT409' using message = 'invalid_status_transition';
  end if;
  return capture;
end
$$;

create function private.ensure_barber_earning(p_booking_id uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare
  booking public.bookings;
  earning public.barber_earnings;
  created boolean;
begin
  select * into booking from public.bookings where id = p_booking_id for update;
  if not found then raise sqlstate 'PT404' using message = 'not_found'; end if;
  perform private.earning_capture(booking);

  insert into public.barber_earnings(booking_id, barber_id, status, gross_cents, commission_cents, barber_net_cents)
    values (booking.id, booking.barber_id, 'pending', booking.gross_cents, booking.commission_cents, booking.barber_net_cents)
    on conflict (booking_id) do nothing returning * into earning;
  created := found;
  if created then
    insert into public.audit_logs(action, entity_type, entity_id, new_value)
      values ('earning.created', 'barber_earnings', earning.id,
        jsonb_build_object('status', earning.status, 'grossCents', earning.gross_cents,
          'commissionCents', earning.commission_cents, 'barberNetCents', earning.barber_net_cents));
  else
    select * into strict earning from public.barber_earnings where booking_id = booking.id;
  end if;

  return jsonb_build_object('earningId', earning.id, 'bookingId', booking.id, 'status', earning.status,
    'grossCents', earning.gross_cents, 'commissionCents', earning.commission_cents,
    'barberNetCents', earning.barber_net_cents, 'commissionPctSnapshot', booking.commission_pct_snapshot)
    || case when created then '{}'::jsonb else jsonb_build_object('idempotent', true) end;
end
$$;

create function private.earn_on_capture() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform private.ensure_barber_earning(new.booking_id);
  return new;
end
$$;

create trigger earn_on_capture after insert on private.payment_capture_events
  for each row when (new.outcome = 'captured') execute function private.earn_on_capture();

-- Existing confirmed captures have the same durable receipt as new ones.
-- Preserve any previously recorded earning and avoid backdating availability.
do $$
begin
  perform private.ensure_barber_earning(event.booking_id)
  from private.payment_capture_events event
  where event.outcome = 'captured' and not exists (
    select from public.barber_earnings earning where earning.booking_id = event.booking_id
  );
end
$$;

create function public.create_barber_earning(p_booking_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then raise insufficient_privilege; end if;
  if p_booking_id is null then return null; end if; -- authorization probe
  return private.ensure_barber_earning(p_booking_id);
end
$$;

create function public.release_barber_earning(p_earning_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  booking public.bookings;
  capture public.payments;
  earning public.barber_earnings;
  cancellation_pct integer;
  retained_commission integer;
  applied boolean := false;
  basis text;
begin
  if auth.role() is distinct from 'service_role' then raise insufficient_privilege; end if;
  if p_earning_id is null then return null; end if; -- authorization probe

  select b.* into booking from public.bookings b
    join public.barber_earnings e on e.booking_id = b.id
    where e.id = p_earning_id for update of b;
  if not found then raise sqlstate 'PT404' using message = 'not_found'; end if;
  if booking.status = 'disputed' or exists (
    select from public.disputes where booking_id = booking.id and status in ('open', 'under_review')
  ) then
    raise sqlstate 'PT409' using message = 'dispute_open';
  end if;

  capture := private.earning_capture(booking);
  select * into strict earning from public.barber_earnings where id = p_earning_id for update;
  if earning.status = 'pending' then
    if booking.status = 'cancelled' then
      -- P3-T07 records the approved cancellation on its verified Stripe mapping.
      select cancellation_refund_pct into cancellation_pct from private.booking_request_snapshots
        where request_id = booking.request_id;
      if capture.status = 'partially_refunded' and capture.refunded_cents between 1 and capture.gross_cents - 1
        and capture.refunded_cents = (capture.gross_cents::bigint * cancellation_pct + 99) / 100
        and exists (select from private.stripe_refund_mappings
          where payment_id = capture.id and is_cancellation and provider_status = 'succeeded'
            and amount_cents = capture.refunded_cents)
      then
        retained_commission := 0;
        basis := 'cancellation_refund';
      end if;
    elsif capture.status = 'captured' and capture.refunded_cents = 0
      and (booking.status = 'completed' or (booking.status = 'admin_resolved' and exists (
        select from public.disputes where booking_id = booking.id and status = 'resolved_barber_paid'
      )))
    then
      retained_commission := booking.commission_cents;
      basis := case booking.status when 'completed' then 'completion' else 'barber_paid_resolution' end;
    elsif booking.status = 'admin_resolved' and capture.status = 'partially_refunded'
      and capture.refunded_cents between 1 and capture.gross_cents - 1
      and exists (select from public.disputes where booking_id = booking.id and status = 'resolved_partial_refund')
      and capture.refunded_cents = (select sum(amount_cents) from private.stripe_refund_mappings
        where payment_id = capture.id and not is_cancellation and provider_status = 'succeeded')
    then
      -- RULE-PAY-11. Match the shared domain allocation using integer division.
      retained_commission :=
        booking.commission_cents::bigint * (capture.gross_cents - capture.refunded_cents) / capture.gross_cents;
      basis := 'partial_refund_resolution';
    end if;

    if basis is null or earning.barber_id <> booking.barber_id or earning.gross_cents <> capture.gross_cents
      or earning.commission_cents <> retained_commission
      or earning.barber_net_cents <> capture.gross_cents - capture.refunded_cents - retained_commission
    then
      raise sqlstate 'PT409' using message = 'invalid_status_transition';
    end if;

    update public.barber_earnings set status = 'available', available_at = clock_timestamp()
      where id = earning.id returning * into earning;
    insert into public.audit_logs(action, entity_type, entity_id, previous_value, new_value, reason)
      values ('earning.released', 'barber_earnings', earning.id, jsonb_build_object('status', 'pending'),
        jsonb_build_object('status', earning.status, 'barberNetCents', earning.barber_net_cents,
          'availableAt', earning.available_at), basis);
    applied := true;
  end if;

  return jsonb_build_object('earningId', earning.id, 'status', earning.status,
    'applied', applied, 'barberNetCents', earning.barber_net_cents);
end
$$;

revoke all on function private.earning_capture(public.bookings), private.ensure_barber_earning(uuid),
  private.earn_on_capture(), public.create_barber_earning(uuid), public.release_barber_earning(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_barber_earning(uuid), public.release_barber_earning(uuid) to service_role;

commit;
