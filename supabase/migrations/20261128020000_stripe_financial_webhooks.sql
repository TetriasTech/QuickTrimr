begin;

-- CFG-STRIPE-WEBHOOK-WORKER. The scheduling entry point lives in operations/.
insert into private.platform_config(key,value) values ('stripe_webhook_worker',
  '{"sweepSeconds":10,"batchSize":20,"concurrency":4,"retryMinutes":[1,5,15,60]}');

create table private.stripe_financial_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique check (event_id ~ '^evt_[A-Za-z0-9_]+$'),
  event_type text not null check (event_type in (
    'payment_intent.succeeded','payment_intent.payment_failed','payment_intent.canceled',
    'charge.refunded','charge.dispute.created',
    'payout.created','payout.updated','payout.paid','payout.failed'
  )),
  account_id text check (account_id ~ '^acct_[A-Za-z0-9]+$'),
  object_id text not null check (object_id ~ '^(pi|ch|du|dp|po)_[A-Za-z0-9]+$'),
  received_at timestamptz not null default now(),
  due_at timestamptz not null default now(),
  state text not null default 'queued' check (state in ('queued','running','processed','review')),
  attempts integer not null default 0 check (attempts >= 0),
  failures integer not null default 0 check (failures >= 0),
  lease uuid,
  check ((state='running')=(lease is not null)),
  check ((event_type like 'payout.%')=(account_id is not null))
);
create index stripe_financial_event_due_idx on private.stripe_financial_events(due_at,id)
  where state='queued';
create index stripe_financial_event_running_idx on private.stripe_financial_events(lease)
  where state='running';

create table private.stripe_financial_event_attempts (
  event_id uuid not null references private.stripe_financial_events(id) on delete restrict,
  attempt integer not null,
  outcome text not null,
  observed_at timestamptz not null default now(),
  primary key(event_id,attempt)
);
create trigger reject_append_only_mutation before update or delete on private.stripe_financial_event_attempts
  for each row execute function private.reject_append_only_mutation();
create trigger reject_append_only_truncate before truncate on private.stripe_financial_event_attempts
  for each statement execute function private.reject_append_only_mutation();

create table private.stripe_financial_worker (
  singleton boolean primary key default true check(singleton),
  lease uuid,
  lease_deadline timestamptz,
  heartbeat_at timestamptz,
  check ((lease is null)=(lease_deadline is null))
);
insert into private.stripe_financial_worker default values;

-- P3-T07 binds each approved refund operation to its resulting Stripe refund.
create table private.stripe_refund_mappings (
  operation_id uuid primary key,
  payment_id uuid not null references public.payments(id) on delete restrict,
  stripe_refund_id text not null unique check (stripe_refund_id ~ '^re_[A-Za-z0-9]+$'),
  amount_cents integer not null check (amount_cents > 0),
  provider_status text not null default 'pending' check (
    provider_status in ('pending','requires_action','succeeded','failed','canceled')
  )
);
create index stripe_refund_mappings_payment_idx on private.stripe_refund_mappings(payment_id);

-- P3-T10/P3-T11 populate the obligation and provider identity before applying
-- bank payout effects. A replacement gets another payout identity.
create table private.stripe_payout_mappings (
  stripe_payout_id text primary key check (stripe_payout_id ~ '^po_[A-Za-z0-9]+$'),
  stripe_account_id text not null check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  item_id uuid not null references public.payout_batch_items(id) on delete restrict,
  is_current boolean not null default true,
  terminal_status text check (terminal_status in ('paid','failed','canceled'))
);
create unique index stripe_payout_current_item_idx on private.stripe_payout_mappings(item_id) where is_current;
create table private.stripe_payout_earning_links (
  earning_id uuid primary key references public.barber_earnings(id) on delete restrict,
  item_id uuid not null references public.payout_batch_items(id) on delete restrict
);
create index stripe_payout_earning_links_item_idx on private.stripe_payout_earning_links(item_id);

-- A review hold is orthogonal to booking, payment and earning status. Closing
-- a hold requires an authorised operation outside this ticket.
create table private.stripe_payment_reviews (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  source text not null check(source in ('bank_dispute','unmatched_refund')),
  object_id text not null check(object_id ~ '^(du|dp|re)_[A-Za-z0-9]+$'),
  observed_cents integer not null check(observed_cents > 0),
  provider_status text not null,
  created_at timestamptz not null default now(),
  unique(source,object_id)
);
create index stripe_payment_review_payment_idx on private.stripe_payment_reviews(payment_id);

alter table private.stripe_financial_events enable row level security;
alter table private.stripe_financial_event_attempts enable row level security;
alter table private.stripe_financial_worker enable row level security;
alter table private.stripe_refund_mappings enable row level security;
alter table private.stripe_payout_mappings enable row level security;
alter table private.stripe_payout_earning_links enable row level security;
alter table private.stripe_payment_reviews enable row level security;
revoke all on private.stripe_financial_events, private.stripe_financial_event_attempts,
  private.stripe_financial_worker, private.stripe_refund_mappings, private.stripe_payout_mappings,
  private.stripe_payout_earning_links, private.stripe_payment_reviews
  from public, anon, authenticated, service_role;

create function private.require_stripe_worker() returns void
language plpgsql stable set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise insufficient_privilege; end if;
end $$;

create function public.enqueue_stripe_financial_event(p_event_id text,p_event_type text,p_account_id text,p_object_id text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform private.require_stripe_worker();
  insert into private.stripe_financial_events(event_id,event_type,account_id,object_id)
    values(p_event_id,p_event_type,p_account_id,p_object_id) on conflict(event_id) do nothing;
  return not found;
end $$;

create function private.record_stripe_financial_failure(p_row private.stripe_financial_events,p_reason text)
returns void language plpgsql set search_path='' as $$
declare retry_minutes integer;
begin
  select (value->'retryMinutes'->>p_row.failures)::integer into retry_minutes
    from private.platform_config where key='stripe_webhook_worker';
  insert into private.stripe_financial_event_attempts(event_id,attempt,outcome)
    values(p_row.id,p_row.attempts,p_reason);
  update private.stripe_financial_events
    set state=case when retry_minutes is null then 'review' else 'queued' end,
        failures=p_row.failures+1, lease=null,
        due_at=clock_timestamp()+make_interval(mins=>coalesce(retry_minutes,0))
    where id=p_row.id;
end $$;

create function public.claim_stripe_financial_events() returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  worker private.stripe_financial_worker;
  interrupted private.stripe_financial_events;
  cfg jsonb;
  token uuid:=gen_random_uuid();
  jobs jsonb;
  server_now timestamptz;
begin
  perform private.require_stripe_worker();
  select * into worker from private.stripe_financial_worker where singleton for update;
  server_now:=clock_timestamp();
  if worker.lease_deadline > server_now then return null; end if;
  select value into strict cfg from private.platform_config where key='stripe_webhook_worker';
  if worker.lease is not null then
    for interrupted in select * from private.stripe_financial_events
      where state='running' and lease=worker.lease for update
    loop
      perform private.record_stripe_financial_failure(interrupted,'worker_interrupted');
    end loop;
  end if;
  with ready as (
    select id from private.stripe_financial_events where state='queued' and due_at<=server_now
    order by due_at,id limit (cfg->>'batchSize')::integer for update skip locked
  ), claimed as (
    update private.stripe_financial_events e set state='running', lease=token, attempts=e.attempts+1
    from ready where e.id=ready.id returning e.event_id,e.event_type,e.account_id,e.object_id
  )
  select jsonb_agg(jsonb_build_object('eventId',event_id,'type',event_type,'accountId',account_id,'objectId',object_id))
    into jobs from claimed;
  update private.stripe_financial_worker set heartbeat_at=clock_timestamp(),
    lease=case when jobs is not null then token end,
    lease_deadline=case when jobs is not null then
      clock_timestamp()+make_interval(mins=>(cfg->'retryMinutes'->>0)::integer) end
    where singleton;
  if jobs is null then return null; end if;
  return jsonb_build_object('lease',token,'concurrency',(cfg->>'concurrency')::integer,'jobs',jobs);
end $$;

create function public.release_stripe_financial_sweep(p_lease uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_stripe_worker();
  update private.stripe_financial_worker set lease=null,lease_deadline=null,heartbeat_at=clock_timestamp()
    where singleton and lease=p_lease and not exists (
      select from private.stripe_financial_events where state='running' and lease=p_lease
    );
end $$;

create function public.replay_stripe_financial_event(p_event_id text) returns boolean
language plpgsql security definer set search_path='' as $$
declare row_id uuid;
begin
  perform private.require_stripe_worker();
  update private.stripe_financial_events set state='queued',due_at=clock_timestamp(),failures=0
    where event_id=p_event_id and state='review' returning id into row_id;
  if not found then return false; end if;
  insert into public.audit_logs(action,entity_type,entity_id,metadata)
    values('stripe_webhook.replay','stripe_financial_events',row_id,jsonb_build_object('eventId',p_event_id));
  return true;
end $$;

create function public.stripe_financial_worker_health() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_stripe_worker();
  return jsonb_build_object(
    'heartbeatAt',(select heartbeat_at from private.stripe_financial_worker where singleton),
    'oldestDueAt',(select min(due_at) from private.stripe_financial_events where state='queued'),
    'reviewCount',(select count(*) from private.stripe_financial_events where state='review')
  );
end $$;

-- Lock in the same order as P3-T02 before reconciling a current provider fact.
create function private.lock_stripe_financial_payment(p_intent text) returns public.payments
language plpgsql set search_path='' as $$
declare target public.payments;
begin
  select p.* into target from public.payments p where p.stripe_payment_intent_id=p_intent;
  if not found then return null; end if;
  perform from public.booking_requests where id=target.booking_request_id for update;
  perform from public.bookings where request_id=target.booking_request_id for update;
  select p.* into target from public.payments p where p.stripe_payment_intent_id=p_intent for update;
  return target;
end $$;

create function private.apply_stripe_intent(p_event private.stripe_financial_events,p_fact jsonb) returns text
language plpgsql set search_path='' as $$
declare
  payment public.payments:=private.lock_stripe_financial_payment(p_event.object_id);
  provider_status text:=p_fact->>'status';
begin
  if payment.id is null then return 'unmapped'; end if;
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
  if payment.status='capture_pending' and provider_status in ('canceled','requires_payment_method','requires_action') then
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

create function private.record_stripe_payment_review(
  p_payment_id uuid,p_source text,p_object_id text,p_amount integer,p_status text
) returns boolean language plpgsql set search_path='' as $$
declare review_id uuid;
begin
  insert into private.stripe_payment_reviews(payment_id,source,object_id,observed_cents,provider_status)
    values(p_payment_id,p_source,p_object_id,p_amount,p_status)
    on conflict(source,object_id) do nothing returning id into review_id;
  if not found then return false; end if;
  insert into public.audit_logs(action,entity_type,entity_id,reason)
    values('payment.stripe_review_hold','stripe_payment_reviews',review_id,p_source);
  return true;
end $$;

create function private.has_stripe_payment_review_hold(p_booking_id uuid) returns boolean
language sql stable set search_path='' as $$
  select exists(select from public.bookings b
    join public.payments p on p.booking_request_id=b.request_id
    join private.stripe_payment_reviews r on r.payment_id=p.id where b.id=p_booking_id)
$$;

create function private.guard_stripe_payment_review_queue() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='queued_for_payout' and (tg_op='INSERT' or old.status not in ('paid_out','queued_for_payout')) then
    perform from public.bookings where id=new.booking_id for update;
    if private.has_stripe_payment_review_hold(new.booking_id) then
      raise check_violation using message='stripe_payment_review_hold';
    end if;
  end if;
  return new;
end $$;
create trigger guard_stripe_payment_review_queue before insert or update of status on public.barber_earnings
  for each row execute function private.guard_stripe_payment_review_queue();

create function private.apply_stripe_charge_review(p_event private.stripe_financial_events,p_fact jsonb) returns text
language plpgsql set search_path='' as $$
declare
  payment public.payments:=private.lock_stripe_financial_payment(p_fact->>'intentId');
  refund record;
  mapping private.stripe_refund_mappings;
  updated boolean:=false;
  awaiting_settlement boolean:=false;
  total_refunded integer;
begin
  if payment.id is null then return 'unmapped'; end if;
  if payment.stripe_charge_id is distinct from p_fact->>'chargeId' then return 'identity_mismatch'; end if;
  if p_event.event_type='charge.dispute.created' then
    if (p_fact->>'amountCents')::integer not between 1 and payment.gross_cents then return 'identity_mismatch'; end if;
    return case when private.record_stripe_payment_review(payment.id,'bank_dispute',p_event.object_id,
      (p_fact->>'amountCents')::integer,p_fact->>'status') then 'applied' else 'unchanged' end;
  end if;
  for refund in select * from jsonb_to_recordset(p_fact->'refunds')
    as r(id text,status text,amount_cents integer)
  loop
    select * into mapping from private.stripe_refund_mappings where stripe_refund_id=refund.id;
    if mapping.operation_id is null or mapping.payment_id<>payment.id or mapping.amount_cents<>refund.amount_cents then
      if refund.status in ('pending','requires_action','succeeded') and
        private.record_stripe_payment_review(payment.id,'unmatched_refund',refund.id,refund.amount_cents,refund.status)
      then updated:=true; end if;
    elsif mapping.provider_status in ('pending','requires_action') then
      awaiting_settlement:=awaiting_settlement or refund.status in ('pending','requires_action');
      if mapping.provider_status<>refund.status then
        update private.stripe_refund_mappings set provider_status=refund.status where operation_id=mapping.operation_id;
        insert into public.audit_logs(action,entity_type,entity_id,previous_value,new_value)
          values('payment.stripe_refund_reconciled','stripe_refund_mappings',mapping.operation_id,
            jsonb_build_object('status',mapping.provider_status),jsonb_build_object('status',refund.status));
        updated:=true;
      end if;
    end if;
  end loop;
  select coalesce(sum(amount_cents),0)::integer into total_refunded
    from private.stripe_refund_mappings where payment_id=payment.id and provider_status='succeeded';
  if total_refunded>payment.gross_cents then raise check_violation; end if;
  if total_refunded>payment.refunded_cents and payment.status in ('captured','partially_refunded','refunded','disputed') then
    update public.payments set refunded_cents=total_refunded,
      status=case when payment.status='disputed' then payment.status
        when total_refunded=payment.gross_cents then 'refunded'::public.payment_status else 'partially_refunded' end
      where id=payment.id;
    insert into public.audit_logs(action,entity_type,entity_id,previous_value,new_value)
      values('payment.stripe_refund_total_reconciled','payments',payment.id,
        jsonb_build_object('refundedCents',payment.refunded_cents),jsonb_build_object('refundedCents',total_refunded));
    updated:=true;
  end if;
  return case when awaiting_settlement then 'provider_pending'
    when updated then 'applied' else 'unchanged' end;
end $$;

create function private.apply_stripe_bank_payout(p_event private.stripe_financial_events,p_fact jsonb) returns text
language plpgsql set search_path='' as $$
declare
  mapping private.stripe_payout_mappings;
  item public.payout_batch_items;
  batch public.payout_batches;
  provider_status text:=p_fact->>'status';
  next_status public.payout_status;
  next_batch public.payout_status;
  next_earning public.earning_status;
  queued_total bigint;
  invalid_links bigint;
begin
  select * into mapping from private.stripe_payout_mappings where stripe_payout_id=p_event.object_id;
  if not found then return 'unmapped'; end if;
  if mapping.stripe_account_id<>p_event.account_id then return 'identity_mismatch'; end if;
  select i.* into item from public.payout_batch_items i where i.id=mapping.item_id;
  select b.* into batch from public.payout_batches b where b.id=item.batch_id for update;
  select i.* into item from public.payout_batch_items i where i.id=mapping.item_id for update;
  select * into strict mapping from private.stripe_payout_mappings where stripe_payout_id=p_event.object_id for update;
  if not mapping.is_current then return 'unchanged'; end if;
  if mapping.stripe_account_id<>p_event.account_id
    or item.barber_net_cents is distinct from (p_fact->>'amountCents')::integer
    or not exists(select from private.stripe_connect_accounts a where a.barber_id=item.barber_id
      and a.stripe_account_id=p_event.account_id and a.platform_account_id=p_fact->>'platformId')
  then return 'identity_mismatch'; end if;
  if mapping.terminal_status in ('failed','canceled') or mapping.terminal_status=provider_status
    or provider_status not in ('paid','failed','canceled') then return 'unchanged'; end if;
  perform from public.barber_earnings e join private.stripe_payout_earning_links l on l.earning_id=e.id
    where l.item_id=item.id order by e.id for update of e;
  select coalesce(sum(e.barber_net_cents),0), count(*) filter(
    where e.barber_id<>item.barber_id or e.status not in ('paid_out','queued_for_payout')
  ) into queued_total,invalid_links
    from private.stripe_payout_earning_links l join public.barber_earnings e on e.id=l.earning_id
    where l.item_id=item.id;
  if invalid_links<>0 or queued_total<>item.barber_net_cents or queued_total<=0 then return 'identity_mismatch'; end if;
  next_status:=case provider_status when 'paid' then 'paid'::public.payout_status
    when 'failed' then 'failed' else 'cancelled' end;
  next_earning:=case when provider_status='paid' then 'paid_out'::public.earning_status else 'queued_for_payout' end;
  update private.stripe_payout_mappings set terminal_status=provider_status where stripe_payout_id=mapping.stripe_payout_id;
  update public.payout_batch_items set status=next_status where id=item.id;
  with changed as (
    update public.barber_earnings e set status=next_earning from private.stripe_payout_earning_links l
      where l.item_id=item.id and l.earning_id=e.id and e.barber_id=item.barber_id
        and e.status in ('paid_out','queued_for_payout') and e.status<>next_earning returning e.id
  )
  insert into public.audit_logs(action,entity_type,entity_id,new_value)
    select 'earning.stripe_bank_payout_reconciled','barber_earnings',id,jsonb_build_object('status',next_earning) from changed;
  select case
    when bool_and(status='paid') then 'paid'::public.payout_status
    when bool_or(status in ('failed','cancelled')) then 'failed'
    else batch.status end
    into next_batch from public.payout_batch_items where batch_id=batch.id;
  if batch.status is distinct from next_batch then
    update public.payout_batches set status=next_batch where id=batch.id;
    insert into public.audit_logs(action,entity_type,entity_id,previous_value,new_value)
      values('payout_batch.stripe_reconciled','payout_batches',batch.id,
        jsonb_build_object('status',batch.status),jsonb_build_object('status',next_batch));
  end if;
  insert into public.audit_logs(action,entity_type,entity_id,previous_value,new_value)
    values('payout.stripe_bank_reconciled','payout_batch_items',item.id,
      jsonb_build_object('status',item.status),jsonb_build_object('status',next_status));
  return 'applied';
end $$;

create function public.finish_stripe_financial_event(
  p_event_id text,p_lease uuid,p_fact jsonb default null
) returns text language plpgsql security definer set search_path='' as $$
declare event_row private.stripe_financial_events;
        outcome text;
begin
  perform private.require_stripe_worker();
  select * into event_row from private.stripe_financial_events e
    where e.event_id=p_event_id and e.state='running' and e.lease=p_lease for update;
  if not found or not exists(select from private.stripe_financial_worker where singleton
    and lease=p_lease and lease_deadline>clock_timestamp()) then return 'stale'; end if;
  outcome:=case when p_fact is null then 'provider_unavailable'
    when event_row.event_type like 'payment_intent.%' then private.apply_stripe_intent(event_row,p_fact)
    when event_row.event_type like 'charge.%' then private.apply_stripe_charge_review(event_row,p_fact)
    else private.apply_stripe_bank_payout(event_row,p_fact) end;
  if outcome in ('provider_unavailable','provider_pending','unmapped','identity_mismatch') then
    perform private.record_stripe_financial_failure(event_row,outcome);
  else
    insert into private.stripe_financial_event_attempts(event_id,attempt,outcome)
      values(event_row.id,event_row.attempts,outcome);
    update private.stripe_financial_events set state='processed',lease=null where id=event_row.id;
  end if;
  return outcome;
end $$;

revoke all on function private.require_stripe_worker(),
  private.record_stripe_financial_failure(private.stripe_financial_events,text),
  private.lock_stripe_financial_payment(text),
  private.apply_stripe_intent(private.stripe_financial_events,jsonb),
  private.record_stripe_payment_review(uuid,text,text,integer,text),
  private.has_stripe_payment_review_hold(uuid),
  private.guard_stripe_payment_review_queue(),
  private.apply_stripe_charge_review(private.stripe_financial_events,jsonb),
  private.apply_stripe_bank_payout(private.stripe_financial_events,jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.enqueue_stripe_financial_event(text,text,text,text),
  public.claim_stripe_financial_events(), public.release_stripe_financial_sweep(uuid),
  public.replay_stripe_financial_event(text), public.stripe_financial_worker_health(),
  public.finish_stripe_financial_event(text,uuid,jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.enqueue_stripe_financial_event(text,text,text,text),
  public.claim_stripe_financial_events(), public.release_stripe_financial_sweep(uuid),
  public.replay_stripe_financial_event(text), public.stripe_financial_worker_health(),
  public.finish_stripe_financial_event(text,uuid,jsonb)
to service_role;
commit;
