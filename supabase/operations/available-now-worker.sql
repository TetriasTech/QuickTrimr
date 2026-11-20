-- P2-T03 versioned operational installation. Apply deliberately in postgres only,
-- after application migrations. No credentials or provider URLs in cron commands.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;
-- Managed extension tables belong to supabase_admin. Cron's own RLS must remain
-- enabled; never change their owner/policies to gain control. QuickTrimr-owned
-- state/outbox/receipt tables enable RLS in the application migrations.
do $$ begin
 if exists(select 1 from pg_class where oid in ('cron.job'::regclass,'cron.job_run_details'::regclass) and not relrowsecurity) then
  raise exception 'provider_cron_rls_missing';
 end if;
end $$;
revoke all on schema cron,vault from public,anon,authenticated,service_role;
revoke all on all tables in schema cron,vault from public,anon,authenticated,service_role;
revoke all on all functions in schema cron from public,anon,authenticated,service_role;
-- net and Vault's cryptographic implementation functions are provider-owned;
-- postgres cannot rewrite their grants. These schemas must remain excluded from
-- the Data API (verified by the API denial checks). Never expose them to make a
-- worker callable; only the private, runtime-inaccessible wrappers use them.

do $$ declare config jsonb:=private.available_now_worker_config(); health_minutes integer; health_schedule text; begin
 health_minutes:=(config->>'healthCheckSeconds')::integer/60; -- protocol seconds/minute conversion
 if current_database()<>'postgres' or (config->>'scheduledConcurrency')::integer<>1
  or (config->>'healthCheckSeconds')::integer%60<>0 or health_minutes not between 1 and 59 then
  raise exception 'available_now_scheduler_config_unsupported';
 end if;
 health_schedule:=case when health_minutes=1 then '* * * * *' else '*/'||health_minutes||' * * * *' end;
 perform cron.schedule('quicktrimr.available_now.expiry',(config->>'sweepSeconds')||' seconds',
  'select private.run_available_now_expiry();');
 perform cron.schedule('quicktrimr.available_now.health',health_schedule,
  'select private.check_available_now_health();');
end $$;
commit;
