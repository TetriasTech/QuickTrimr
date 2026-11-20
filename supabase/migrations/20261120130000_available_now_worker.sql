-- P2-T03. Feature-specific bounded worker and safe monitoring state.
-- Extension/schedule installation is versioned separately in supabase/operations:
-- pg_cron must run in its configured database, not migration-replay scratch DBs.
begin;
insert into private.platform_config(key,value) values
 ('available_now_worker_monitor','{"organizationId":"4512461851983872","projectId":"4512461869744128","ingestHost":"o4512461851983872.ingest.us.sentry.io","monitorSlug":"available-now-worker-health","environment":"development"}');
create table private.available_now_worker_state(
 singleton boolean primary key default true check(singleton),
 last_success_at timestamptz,
 failure_ack bigint not null default 0,
 cron_seen bigint not null default 0,
 last_monitor_minute timestamptz
);
insert into private.available_now_worker_state(singleton) values(true);
create table private.available_now_worker_runs(
 id bigint generated always as identity primary key,
 started_at timestamptz not null, finished_at timestamptz not null,
 outcome text not null check(outcome in ('succeeded','failed')),
 processed integer not null check(processed>=0),
 error_code text check(error_code ~ '^[A-Z0-9]{5}$')
);
create index available_now_worker_runs_retention on private.available_now_worker_runs(finished_at,id);
create table private.available_now_worker_failures(
 id bigint generated always as identity primary key,
 source text not null check(source in ('worker','cron')),
 source_id bigint not null,
 detected_at timestamptz not null default clock_timestamp(),
 unique(source,source_id)
);
create table private.available_now_monitor_deliveries(
 id bigint generated always as identity primary key,
 minute_start timestamptz not null unique,
 created_at timestamptz not null default clock_timestamp(),
 request_id bigint not null,
 health_status text not null check(health_status in ('ok','error')),
 failure_through bigint not null,
 outcome text check(outcome in ('accepted','rejected','unknown')),
 http_status integer
);
create index available_now_monitor_pending on private.available_now_monitor_deliveries(id) where outcome is null;
do $$ declare name text; begin
 foreach name in array array['available_now_worker_state','available_now_worker_runs','available_now_worker_failures','available_now_monitor_deliveries'] loop
  execute format('alter table private.%I enable row level security',name);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',name);
 end loop;
end $$;
revoke all on sequence private.available_now_worker_runs_id_seq,private.available_now_worker_failures_id_seq,
 private.available_now_monitor_deliveries_id_seq from public,anon,authenticated,service_role;

create function private.available_now_worker_config() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare config jsonb; name text;
begin
 select value into config from private.platform_config where key='available_now_worker_operations';
 foreach name in array array['sweepSeconds','batchSize','scheduledConcurrency','healthCheckSeconds','staleHeartbeatSeconds','overdueSeconds','runRetentionDays'] loop
  if not coalesce(jsonb_typeof(config->name)='number' and (config->>name)::numeric>0 and (config->>name)::numeric=trunc((config->>name)::numeric),false) then
   raise exception 'available_now_worker_config_invalid';
  end if;
 end loop;
 return config;
end $$;
revoke all on function private.available_now_worker_config() from public,anon,authenticated,service_role;

create function private.run_available_now_expiry() returns jsonb
language plpgsql security definer set search_path='' as $$
declare config jsonb; item record; effect jsonb; processed integer:=0; run_id bigint; started timestamptz:=clock_timestamp(); sweep_now timestamptz;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('quicktrimr.available_now.expiry',0)) then
  return '{"skipped":true}'::jsonb;
 end if;
 -- Also serializes failure IDs/health watermarks. No network is performed in this transaction.
 perform 1 from private.available_now_worker_state where singleton for update;
 begin
  config:=private.available_now_worker_config();
  sweep_now:=clock_timestamp(); -- a bound index parameter, not a volatile per-row filter
  for item in
   select s.id from public.available_now_sessions s
   cross join lateral (select p.id from public.profiles p where p.id=s.barber_id for update skip locked) claimed
   where s.status='active' and s.available_until<=sweep_now
   order by s.available_until,s.id limit (config->>'batchSize')::integer
  loop
   effect:=private.transition_available_now_session(item.id,'expired');
   if (effect->>'applied')::boolean then processed:=processed+1; end if;
  end loop;
  insert into private.available_now_worker_runs(started_at,finished_at,outcome,processed)
   values(started,clock_timestamp(),'succeeded',processed) returning id into run_id;
  update private.available_now_worker_state set last_success_at=clock_timestamp() where singleton;
  return jsonb_build_object('outcome','succeeded','processed',processed,'runId',run_id);
 exception when others then
  -- The subtransaction rolls back the ENTIRE batch, including its audits. Store
  -- only a SQLSTATE, never SQLERRM/query text which could contain sensitive data.
  insert into private.available_now_worker_runs(started_at,finished_at,outcome,processed,error_code)
   values(started,clock_timestamp(),'failed',0,sqlstate) returning id into run_id;
  insert into private.available_now_worker_failures(source,source_id) values('worker',run_id);
  return jsonb_build_object('outcome','failed','processed',0,'runId',run_id);
 end;
end $$;
revoke all on function private.run_available_now_expiry() from public,anon,authenticated,service_role;

-- Pure mirror of packages/domain availabilityWorkerHealth, parity tested at
-- strict heartbeat/overdue boundaries without exposing a runtime fake clock.
create function private.available_now_health_effect(last_success timestamptz,oldest timestamptz,failures bigint,server_now timestamptz,config jsonb)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('staleHeartbeat',s,'overdue',o,'failedRuns',failures,'healthy',not(s or o or failures>0))
 from (select last_success is null or server_now-last_success>(config->>'staleHeartbeatSeconds')::numeric*interval '1 second' s,
  coalesce(server_now-oldest>(config->>'overdueSeconds')::numeric*interval '1 second',false) o) flags;
$$;
revoke all on function private.available_now_health_effect(timestamptz,timestamptz,bigint,timestamptz,jsonb) from public,anon,authenticated,service_role;

create function private.available_now_worker_health() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare config jsonb:=private.available_now_worker_config(); server_now timestamptz:=clock_timestamp();
 last_success timestamptz; oldest timestamptz; failures bigint;
begin
 select last_success_at into last_success from private.available_now_worker_state where singleton;
 select available_until into oldest from public.available_now_sessions
  where status='active' and available_until<=server_now order by available_until,id limit 1;
 select count(*) into failures from private.available_now_worker_failures
  where id>(select failure_ack from private.available_now_worker_state where singleton);
 return jsonb_build_object('serverNow',server_now,'lastSuccessAt',last_success,'oldestDueAt',oldest)
  ||private.available_now_health_effect(last_success,oldest,failures,server_now,config);
end $$;
revoke all on function private.available_now_worker_health() from public,anon,authenticated,service_role;

create function private.prune_available_now_worker_history() returns void
language plpgsql security definer set search_path='' as $$
declare config jsonb:=private.available_now_worker_config(); cutoff timestamptz;
begin
 cutoff:=clock_timestamp()-(config->>'runRetentionDays')::numeric*interval '1 day';
 delete from private.available_now_worker_runs where id in (select id from private.available_now_worker_runs
  where finished_at<cutoff order by finished_at,id limit (config->>'batchSize')::integer);
 delete from private.available_now_monitor_deliveries where id in (select id from private.available_now_monitor_deliveries
  where created_at<cutoff and outcome is not null order by id limit (config->>'batchSize')::integer);
 -- Unreported failures remain recoverable; immutable business audit/receipts are never touched.
 delete from private.available_now_worker_failures where id in (select id from private.available_now_worker_failures
  where detected_at<cutoff and id<=(select failure_ack from private.available_now_worker_state where singleton)
  order by id limit (config->>'batchSize')::integer);
 if to_regclass('cron.job_run_details') is not null then
  delete from cron.job_run_details where runid in (
   select d.runid from cron.job_run_details d join cron.job j on j.jobid=d.jobid
   where j.jobname in ('quicktrimr.available_now.expiry','quicktrimr.available_now.health') and d.end_time<cutoff
    and d.runid<=(select cron_seen from private.available_now_worker_state where singleton)
   order by d.end_time,d.runid limit (config->>'batchSize')::integer);
 end if;
end $$;
revoke all on function private.prune_available_now_worker_history() from public,anon,authenticated,service_role;

-- pg_net transmits AFTER commit. Vault/cron/net are installed by the versioned
-- operational setup, not needed to replay the application schema in scratch DBs.
create function private.check_available_now_health() returns jsonb
language plpgsql security definer set search_path='' as $$
declare config jsonb:=private.available_now_worker_config(); monitor jsonb; snapshot jsonb;
 credential text; parts text[]; minute_start timestamptz:=date_trunc('minute',clock_timestamp());
 previous_minute timestamptz; delivery record; cron_run record; request_id bigint; failure_through bigint; status text;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('quicktrimr.available_now.health',0)) then return '{"skipped":true}'::jsonb; end if;
 select last_monitor_minute into previous_minute from private.available_now_worker_state where singleton for update;
 -- Discover hard-interrupted cron runs independently of the worker's own transaction.
 if to_regclass('cron.job_run_details') is not null then
  -- runid is the provider PK. One pg_cron job never overlaps itself, so its
  -- terminal runs can be advanced in order without skipping an older live run.
  -- The fixed batch avoids rescanning a month of history on every health tick.
  for cron_run in select d.runid,d.status from cron.job_run_details d join cron.job j on j.jobid=d.jobid
   where j.jobname='quicktrimr.available_now.expiry' and d.status in ('succeeded','failed')
    and d.runid>(select cron_seen from private.available_now_worker_state where singleton)
   order by d.runid limit (config->>'batchSize')::integer
  loop
   if cron_run.status='failed' then
    insert into private.available_now_worker_failures(source,source_id) values('cron',cron_run.runid) on conflict(source,source_id) do nothing;
   end if;
   update private.available_now_worker_state set cron_seen=cron_run.runid where singleton;
  end loop;
 end if;
 for delivery in select d.id,d.failure_through,d.created_at,r.status_code
  from private.available_now_monitor_deliveries d left join net._http_response r on r.id=d.request_id
  where d.outcome is null order by d.id limit (config->>'batchSize')::integer
 loop
  if delivery.status_code between 200 and 299 then
   update private.available_now_monitor_deliveries set outcome='accepted',http_status=delivery.status_code where id=delivery.id;
   update private.available_now_worker_state set failure_ack=greatest(failure_ack,delivery.failure_through) where singleton;
  elsif delivery.status_code is not null then
   update private.available_now_monitor_deliveries set outcome='rejected',http_status=delivery.status_code where id=delivery.id;
  elsif delivery.created_at<minute_start then
   update private.available_now_monitor_deliveries set outcome='unknown' where id=delivery.id;
  end if;
 end loop;
 snapshot:=private.available_now_worker_health();
 perform private.prune_available_now_worker_history();
 if previous_minute=minute_start then return snapshot||'{"skipped":true}'::jsonb; end if;
 select decrypted_secret into credential from vault.decrypted_secrets where name='available_now_worker_dsn';
 if credential is null then return snapshot||'{"monitorConfigured":false}'::jsonb; end if;
 select value into monitor from private.platform_config where key='available_now_worker_monitor';
 parts:=regexp_match(credential,'^https://([a-f0-9]+)@(o[0-9]+\.ingest\.us\.sentry\.io)/([0-9]+)$');
 if parts is null or parts[2] is distinct from monitor->>'ingestHost' or parts[3] is distinct from monitor->>'projectId' then
  raise exception 'available_now_monitor_config_invalid';
 end if;
 select coalesce(max(id),0) into failure_through from private.available_now_worker_failures;
 status:=case when (snapshot->>'healthy')::boolean then 'ok' else 'error' end;
 request_id:=net.http_post(
  url:='https://'||parts[2]||'/api/'||parts[3]||'/cron/'||(monitor->>'monitorSlug')||'/'||parts[1]||'/',
  headers:='{"Content-Type":"application/json"}'::jsonb,
  body:=jsonb_build_object('status',status,'environment',monitor->>'environment',
   'monitor_config',jsonb_build_object('schedule',jsonb_build_object('type','interval','value',(config->>'healthCheckSeconds')::integer/60,'unit','minute'),
    'checkin_margin',((config->>'staleHeartbeatSeconds')::integer-(config->>'healthCheckSeconds')::integer)/60,
    'failure_issue_threshold',1,'recovery_threshold',1,'timezone','UTC')));
 insert into private.available_now_monitor_deliveries(minute_start,request_id,health_status,failure_through)
  values(minute_start,request_id,status,failure_through);
 update private.available_now_worker_state set last_monitor_minute=minute_start where singleton;
 return snapshot||jsonb_build_object('monitorConfigured',true,'queued',true);
end $$;
revoke all on function private.check_available_now_health() from public,anon,authenticated,service_role;
commit;
