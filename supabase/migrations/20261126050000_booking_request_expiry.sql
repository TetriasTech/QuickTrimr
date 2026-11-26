-- P2-T15. Due work comes from immutable request deadlines, including recovery.
begin;

insert into private.platform_config(key, value) values (
  'booking_request_expiry_operations',
  '{"sweepSeconds":10,"reconcileSeconds":30,"batchSize":500,"scheduledConcurrency":1,"healthCheckSeconds":60,"staleHeartbeatSeconds":120,"overdueSeconds":60,"runRetentionDays":30,"peakDueRequests":1000,"peakHistoricalRequests":100000,"peakExpiryLatenessSecondsExclusive":60}'
);

create index booking_requests_due_idx on public.booking_requests(expires_at, id)
  include (barber_id) where status = 'pending' and expires_at is not null;

create table private.booking_request_expiry_runs (
  id bigint generated always as identity primary key,
  mode text not null check (mode in ('primary', 'reconcile')),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  processed integer not null check (processed >= 0),
  failed integer not null check (failed >= 0)
);
alter table private.booking_request_expiry_runs enable row level security;
revoke all on private.booking_request_expiry_runs from public, anon, authenticated, service_role;
revoke all on sequence private.booking_request_expiry_runs_id_seq from public, anon, authenticated, service_role;
create index booking_request_expiry_runs_retention
  on private.booking_request_expiry_runs(finished_at, id);
create index booking_request_expiry_runs_heartbeat
  on private.booking_request_expiry_runs(mode, finished_at desc) where failed = 0;
create index booking_request_expiry_runs_failures
  on private.booking_request_expiry_runs(finished_at desc) where failed > 0;

create function private.expire_booking_request(p_request_id uuid)
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

  if target.booking_type = 'available_now' then
    perform private.record_available_now_request_outcome(target.id, 'expired');
  end if;
  -- The request ID plus this audit action identifies the durable expiry outcome.
  -- P3-T06 consumes it for authorization release outside this transaction.
  insert into public.audit_logs(action, entity_type, entity_id, previous_value, new_value,
    reason, metadata, created_at, updated_at)
  values ('booking_request.expired', 'booking_requests', target.id,
    jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'expired'),
    'The server deadline elapsed without a response.',
    jsonb_build_object('bookingType', target.booking_type, 'expiresAt', target.expires_at),
    server_now, server_now);
  return jsonb_build_object('requestId', target.id, 'applied', true, 'status', 'expired');
end;
$$;
revoke all on function private.expire_booking_request(uuid) from public, anon, authenticated, service_role;

create function public.expire_booking_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  return private.expire_booking_request(p_request_id);
end;
$$;
revoke all on function public.expire_booking_request(uuid) from public, anon, authenticated, service_role;
grant execute on function public.expire_booking_request(uuid) to service_role;

create function private.booking_request_expiry_config() returns jsonb
language sql stable set search_path = '' as $$
  select value from private.platform_config where key = 'booking_request_expiry_operations';
$$;
revoke all on function private.booking_request_expiry_config() from public, anon, authenticated, service_role;

create function private.prune_booking_request_expiry_runs(cutoff timestamptz, batch_size integer)
returns void language plpgsql set search_path = '' as $$
begin
  delete from private.booking_request_expiry_runs where id in (
    select id from private.booking_request_expiry_runs
    where finished_at < cutoff order by finished_at, id limit batch_size
  );
  if to_regclass('cron.job_run_details') is not null then
    delete from cron.job_run_details where runid in (
      select run.runid from cron.job_run_details run join cron.job job using (jobid)
      where job.jobname in ('quicktrimr.request_expiry.primary', 'quicktrimr.request_expiry.reconcile')
        and run.end_time < cutoff order by run.runid limit batch_size
    );
  end if;
end;
$$;
revoke all on function private.prune_booking_request_expiry_runs(timestamptz, integer)
  from public, anon, authenticated, service_role;

create function private.run_booking_request_expiry(p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  config jsonb; batch_size integer; item record; processed integer := 0;
  failed integer := 0; effect jsonb; sweep_now timestamptz := clock_timestamp();
begin
  if p_mode is null or p_mode not in ('primary', 'reconcile') then
    raise invalid_parameter_value;
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('quicktrimr.request_expiry', 0)) then
    return '{"skipped":true}'::jsonb;
  end if;
  config := private.booking_request_expiry_config();
  batch_size := (config->>'batchSize')::integer;
  if batch_size is null or batch_size <= 0 then raise invalid_parameter_value; end if;

  -- Both jobs query the source of truth, so a missing tick or rolled-back
  -- claim needs no per-request job row. Bound candidates before claiming.
  for item in
    with due as materialized (
      select r.id, r.barber_id, r.expires_at from public.booking_requests r
      where r.status = 'pending' and r.expires_at is not null and r.expires_at <= sweep_now
      order by r.expires_at, r.id limit batch_size
    )
    select due.id from due
    cross join lateral (
      select p.id from public.profiles p where p.id = due.barber_id for update skip locked
    ) parent
    order by due.expires_at, due.id
  loop
    begin
      effect := private.expire_booking_request(item.id);
      if (effect->>'applied')::boolean then processed := processed + 1; end if;
    exception when others then
      -- Roll back this request and its effects. Count the fault without
      -- exposing IDs, payloads or SQL errors in operational output.
      failed := failed + 1;
    end;
  end loop;
  if p_mode = 'reconcile' then
    perform private.prune_booking_request_expiry_runs(
      sweep_now - (config->>'runRetentionDays')::integer * interval '1 day', batch_size);
  end if;
  insert into private.booking_request_expiry_runs(mode, started_at, finished_at, processed, failed)
    values (p_mode, sweep_now, clock_timestamp(), processed, failed);
  return jsonb_build_object('processed', processed, 'failed', failed);
end;
$$;
revoke all on function private.run_booking_request_expiry(text) from public, anon, authenticated, service_role;

-- Queried by an independent monitor via the database operator connection.
-- Only aggregate timestamps leave the database, never request or actor IDs.
create function private.booking_request_expiry_health()
returns jsonb language plpgsql set search_path = '' as $$
declare
  server_now timestamptz := clock_timestamp(); last_cron_failure timestamptz;
begin
  if to_regclass('cron.job_run_details') is not null then
    select max(run.end_time) into last_cron_failure
    from cron.job_run_details run join cron.job job using (jobid)
    where job.jobname in ('quicktrimr.request_expiry.primary', 'quicktrimr.request_expiry.reconcile')
      and run.status = 'failed'
      and run.end_time > server_now - (private.booking_request_expiry_config()->>'staleHeartbeatSeconds')::integer * interval '1 second';
  end if;
  return jsonb_build_object(
    'serverNow', server_now,
    'primaryHeartbeat', (select finished_at from private.booking_request_expiry_runs
      where mode = 'primary' and failed = 0 order by finished_at desc limit 1),
    'reconcileHeartbeat', (select finished_at from private.booking_request_expiry_runs
      where mode = 'reconcile' and failed = 0 order by finished_at desc limit 1),
    'oldestDueAt', (select expires_at from public.booking_requests
      where status = 'pending' and expires_at is not null and expires_at <= server_now order by expires_at, id limit 1),
    'lastFailureAt', greatest(last_cron_failure, (select finished_at from private.booking_request_expiry_runs
      where failed > 0 order by finished_at desc limit 1))
  );
end;
$$;
revoke all on function private.booking_request_expiry_health() from public, anon, authenticated, service_role;

commit;
