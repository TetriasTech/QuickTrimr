-- P2-T08 / TRIMR-51. Atomic request creation; no payment/provider I/O.
begin;
insert into private.platform_config(key,value) values
 ('commission_pct','20'),('available_request_expiry_minutes','5'),('scheduled_request_expiry_hours','2'),
 ('cancel_refund_pct','{"scheduled":75,"available_now":50}'),
 ('inconvenience_pct','{"scheduled":25,"available_now":50}'),('late_cancel_window_hours','12');

alter table public.booking_requests
 add column service_category_id uuid references public.service_categories(id) on delete restrict,
 add column barber_service_id uuid references public.barber_services(id) on delete restrict,
 add column scheduled_for timestamptz check(scheduled_for is null or isfinite(scheduled_for)),
 add column expires_at timestamptz check(expires_at is null or isfinite(expires_at)),
 add column intent_key text;
-- No address, notes, contact, financial policy or key is granted to the existing
-- pre-acceptance barber SELECT policy. New public fields are granted individually.
grant select(service_category_id,barber_service_id,scheduled_for,expires_at)
 on public.booking_requests to authenticated;
revoke insert,update,delete,truncate on public.booking_requests from public,anon,authenticated,service_role;
create index booking_requests_active_client_idx on public.booking_requests(client_id,booking_type,expires_at)
 where status='pending';
create index booking_requests_active_intent_idx on public.booking_requests(client_id,intent_key,expires_at)
 where status='pending';

create table private.booking_request_snapshots(
 request_id uuid primary key references public.booking_requests(id) on delete restrict,
 service_price_cents integer not null check(service_price_cents>0),
 commission_pct_snapshot integer not null check(commission_pct_snapshot between 0 and 100),
 gross_cents integer not null check(gross_cents=service_price_cents),
 commission_cents integer not null check(commission_cents>=0),
 barber_net_cents integer not null check(barber_net_cents>=0 and barber_net_cents+commission_cents=gross_cents),
 cancellation_refund_pct integer not null check(cancellation_refund_pct between 0 and 100),
 cancellation_inconvenience_pct integer not null check(cancellation_inconvenience_pct+cancellation_refund_pct=100),
 late_cancel_window_hours integer not null check(late_cancel_window_hours>0),
 client_address_id uuid not null references public.client_addresses(id) on delete restrict,
 address_snapshot jsonb not null,
 address_location extensions.geography(Point,4326) not null,
 client_snapshot jsonb not null,
 barber_snapshot jsonb not null,
 service_snapshot jsonb not null,
 notes text,
 created_at timestamptz not null,
 check(commission_cents=floor(service_price_cents::numeric*commission_pct_snapshot/100))
);
alter table private.booking_request_snapshots enable row level security;
revoke all on private.booking_request_snapshots from public,anon,authenticated,service_role;
create trigger reject_append_only_mutation before update or delete on private.booking_request_snapshots
 for each row execute function private.reject_append_only_mutation();
create trigger reject_append_only_truncate before truncate on private.booking_request_snapshots
 for each statement execute function private.reject_append_only_mutation();

create function private.protect_request_intent() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op in ('DELETE','TRUNCATE') then raise insufficient_privilege using message='Requests cannot be deleted'; end if;
 if (to_jsonb(new)-'status'-'updated_at') is distinct from (to_jsonb(old)-'status'-'updated_at') then
  raise insufficient_privilege using message='Request intent is immutable';
 end if;
 return new;
end $$;
create trigger request_intent_immutable before update or delete on public.booking_requests
 for each row execute function private.protect_request_intent();
create trigger request_no_truncate before truncate on public.booking_requests
 for each statement execute function private.protect_request_intent();
revoke all on function private.protect_request_intent() from public,anon,authenticated,service_role;

-- Atomic SQL mirror of packages/domain requestSnapshot. The live verifier proves
-- parity (including uneven cents/config edits). No frontend supplies this policy.
create function private.request_money_snapshot(price integer,kind public.booking_type,server_now timestamptz,policy jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare pct integer:=(policy->>'commissionPct')::integer;
 refund integer:=(policy->'refundPct'->>kind::text)::integer;
 inconvenience integer:=(policy->'inconveniencePct'->>kind::text)::integer;
 late_hours integer:=(policy->>'lateCancellationHours')::integer;
 avail_minutes integer:=(policy->>'availableExpiryMinutes')::integer;
 sched_hours integer:=(policy->>'scheduledExpiryHours')::integer;
 commission integer;
begin
 if price is null or price<=0 or pct is null or pct not between 0 and 100 or refund is null or refund not between 0 and 100
  or inconvenience is null or inconvenience+refund<>100 or late_hours is null or late_hours<=0
  or avail_minutes is null or avail_minutes<=0 or sched_hours is null or sched_hours<=0
  or server_now is null or not isfinite(server_now) or kind is null then raise exception 'request_config_invalid'; end if;
 commission:=floor(price::numeric*pct/100)::integer;
 return jsonb_build_object('servicePriceCents',price,'commissionPct',pct,'grossCents',price,
  'commissionCents',commission,'barberNetCents',price-commission,'cancellationRefundPct',refund,
  'cancellationInconveniencePct',inconvenience,'lateCancellationHours',late_hours,
  'expiresAt',server_now+case when kind='available_now' then make_interval(mins=>avail_minutes) else make_interval(hours=>sched_hours) end);
end $$;
revoke all on function private.request_money_snapshot(integer,public.booking_type,timestamptz,jsonb) from public,anon,authenticated,service_role;

-- Exact-boundary SQL mirror of domain scheduledTimeIssue, used with a single
-- post-lock server instant. Only elapsed global bounds, no calendar/overlap rule.
create function private.request_scheduled_error(requested timestamptz,server_now timestamptz,lead integer,horizon integer)
returns text language sql immutable set search_path='' as $$
 select case when requested is null or not isfinite(requested) then 'Choose a requested date and time.'
 when requested<server_now+make_interval(mins=>lead) then
 format('Scheduled bookings need at least %s notice. Try Available Now for sooner.',
  case when lead%60=0 then (lead/60)::text||' hours''' else lead::text||' minutes''' end)
 when requested>server_now+horizon*interval '24 hours' then format('Choose a requested time within %s days.',horizon)
 else null end;
$$;
revoke all on function private.request_scheduled_error(timestamptz,timestamptz,integer,integer) from public,anon,authenticated,service_role;

create function public.create_booking_request(p_client_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 client public.client_profiles; barber public.barber_profiles; address public.client_addresses;
 category public.service_categories; service public.barber_services; session public.available_now_sessions;
 kind public.booking_type; requested timestamptz; server_now timestamptz;
 policy jsonb; config jsonb; money jsonb; lead integer; horizon integer; issue text; intent text;
 saved public.booking_requests;
begin
 if auth.role() is distinct from 'service_role' then raise insufficient_privilege using message='request_forbidden'; end if;
 -- Serialize clients (including requests to different barbers), and lock the
 -- barber parent BEFORE reliability/session children. Sort two parents to keep
 -- cross-role changes deterministic. No network I/O occurs inside this transaction.
 perform 1 from public.profiles where id in(p_client_id,(p_input->>'barberId')::uuid) order by id for update;
 if not exists(select 1 from public.profiles where id=p_client_id and role='client') then
  raise insufficient_privilege using message='request_forbidden'; end if;
 select * into client from public.client_profiles where id=p_client_id for share;
 if client.display_name is null or client.mobile is null then raise insufficient_privilege using message='onboarding_incomplete'; end if;
 select * into address from public.client_addresses where id=(p_input->>'clientAddressId')::uuid
  and client_id=p_client_id and archived_at is null and directory_id is not null for share;
 if not found then raise sqlstate 'PT422' using message='validation_failed',detail='{"clientAddressId":"Choose one of your active saved addresses."}'; end if;
 select * into barber from public.barber_profiles where id=(p_input->>'barberId')::uuid for share;
 if not found or barber.display_name is null then raise sqlstate 'PT409' using message='barber_unavailable'; end if;
 -- Read committed Connect facts without locking its child row: the existing
 -- refresh transaction locks that child before updating profiles. Taking a child
 -- lock here after the parent would invert its order and could deadlock.
 -- The profile lock serializes publication of changed verification state.
 if not exists(select 1 from private.connect_eligible_barbers where barber_id=barber.id) then
  raise sqlstate 'PT409' using message='barber_unavailable'; end if;
 select * into category from public.service_categories where id=(p_input->>'serviceCategoryId')::uuid for share;
 if not found or category.archived_at is not null then raise sqlstate 'PT409' using message='barber_unavailable'; end if;
 select * into service from public.barber_services where barber_id=barber.id and service_category_id=category.id for share;
 if not found or service.archived_at is not null or service.price_cents not between category.min_price_cents and category.max_price_cents then
  raise sqlstate 'PT409' using message='barber_unavailable'; end if;
 kind:=(p_input->>'bookingType')::public.booking_type;
 if kind is null then raise sqlstate 'PT422' using message='validation_failed',detail='{"_request":"Choose a booking type."}'; end if;
 if kind='available_now' then
  select * into session from public.available_now_sessions where barber_id=barber.id and status='active' for share;
 end if;
 -- Lock config rows so snapshots cannot straddle a concurrent config transaction.
 select jsonb_object_agg(key,value) into config from (
  select key,value from private.platform_config where key in('commission_pct','available_request_expiry_minutes',
   'scheduled_request_expiry_hours','cancel_refund_pct','inconvenience_pct','late_cancel_window_hours',
   'scheduled_min_lead_minutes','scheduled_max_horizon_days') order by key for share
 ) locked;
 server_now:=clock_timestamp();
 if not coalesce((select case when kind='available_now' then available_now_allowed else scheduled_allowed end
  from private.barber_booking_eligibility(barber.id,server_now)),false) then raise sqlstate 'PT409' using message='barber_unavailable'; end if;
 -- RULE-ADDRESS-02: a saved address is not a promise of barber coverage. Never
 -- trust the stale discovery result or a client-supplied point/session reference.
 if kind='available_now' then
  if session.id is null or session.available_until is null or session.available_until<=server_now or session.radius_km is null
   or not extensions.st_dwithin(session.location,address.location,session.radius_km::double precision*1000) then
   raise sqlstate 'PT409' using message='barber_unavailable'; end if;
 else
  if barber.service_area is null or barber.service_radius_km is null
   or not extensions.st_dwithin(barber.service_area,address.location,barber.service_radius_km::double precision*1000) then
   raise sqlstate 'PT409' using message='barber_unavailable'; end if;
  requested:=(p_input->>'scheduledFor')::timestamptz;
  lead:=(config->>'scheduled_min_lead_minutes')::integer; horizon:=(config->>'scheduled_max_horizon_days')::integer;
  if lead is null or horizon is null or lead<=0 or horizon<=0 or lead::bigint>horizon::bigint*24*60 then raise exception 'request_config_invalid'; end if;
  issue:=private.request_scheduled_error(requested,server_now,lead,horizon);
  if issue is not null then raise sqlstate 'PT422' using message='validation_failed',detail=jsonb_build_object('scheduledFor',issue)::text; end if;
 end if;
 -- Intent identity is server-derived and scoped to the verified client. Address,
 -- notes and forged keys cannot bypass the one-pending intent policy. Conflict
 -- queries ignore elapsed deadlines; P2-T15 owns their terminal status/outcome.
 intent:=encode(extensions.digest(jsonb_build_array(p_client_id,kind,barber.id,category.id,extract(epoch from requested))::text,'sha256'),'hex');
 if kind='available_now' and exists(select 1 from public.booking_requests where client_id=p_client_id
  and booking_type=kind and status='pending' and (expires_at is null or expires_at>server_now)) then
  raise sqlstate 'PT409' using message='active_request_exists'; end if;
 if kind='scheduled' and exists(select 1 from public.booking_requests where client_id=p_client_id
  and intent_key=intent and status='pending' and expires_at>server_now) then
  raise sqlstate 'PT409' using message='duplicate_request_intent'; end if;
 policy:=jsonb_build_object('commissionPct',config->'commission_pct','refundPct',config->'cancel_refund_pct',
  'inconveniencePct',config->'inconvenience_pct','lateCancellationHours',config->'late_cancel_window_hours',
  'availableExpiryMinutes',config->'available_request_expiry_minutes','scheduledExpiryHours',config->'scheduled_request_expiry_hours');
 money:=private.request_money_snapshot(service.price_cents,kind,server_now,policy);
 insert into public.booking_requests(client_id,barber_id,booking_type,status,service_category_id,barber_service_id,
  scheduled_for,expires_at,intent_key,available_now_session_id,created_at,updated_at)
 values(p_client_id,barber.id,kind,'pending',category.id,service.id,requested,(money->>'expiresAt')::timestamptz,
  intent,session.id,server_now,server_now) returning * into saved;
 insert into private.booking_request_snapshots(request_id,service_price_cents,commission_pct_snapshot,gross_cents,
  commission_cents,barber_net_cents,cancellation_refund_pct,cancellation_inconvenience_pct,late_cancel_window_hours,
  client_address_id,address_snapshot,address_location,client_snapshot,barber_snapshot,service_snapshot,notes,created_at)
 values(saved.id,service.price_cents,(money->>'commissionPct')::integer,service.price_cents,
  (money->>'commissionCents')::integer,(money->>'barberNetCents')::integer,(money->>'cancellationRefundPct')::integer,
  (money->>'cancellationInconveniencePct')::integer,(money->>'lateCancellationHours')::integer,address.id,
  private.saved_address(address),address.location,jsonb_build_object('displayName',client.display_name,'mobile',client.mobile),
  jsonb_build_object('displayName',barber.display_name,'publicAreaId',barber.public_area_id),
  jsonb_build_object('displayName',category.display_name,'slug',category.slug),p_input->>'notes',server_now);
 insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_value)
 values(p_client_id,'client','booking_request.created','booking_requests',saved.id,
  jsonb_build_object('status','pending','bookingType',kind));
 return (money-'cancellationRefundPct'-'cancellationInconveniencePct'-'lateCancellationHours')||
  jsonb_build_object('id',saved.id,'status','pending','bookingType',kind,'createdAt',server_now);
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
 raise sqlstate 'PT422' using message='validation_failed',detail='{"_request":"Enter valid request fields."}';
end $$;
revoke all on function public.create_booking_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_booking_request(uuid,jsonb) to service_role;
commit;
