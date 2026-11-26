-- Install as postgres in the local QuickTrimr database after the migration.
-- Retain the provider's RLS and keep the extension outside API schemas.
begin;
create extension if not exists pg_cron;

do $$
declare
  config jsonb := private.booking_request_expiry_config();
  primary_seconds integer := (config->>'sweepSeconds')::integer;
  reconcile_seconds integer := (config->>'reconcileSeconds')::integer;
begin
  if current_database() <> 'postgres' or (config->>'scheduledConcurrency')::integer is distinct from 1
    or not coalesce(primary_seconds between 1 and 59 and reconcile_seconds between 1 and 59, false)
    or exists (select 1 from pg_class
      where oid in ('cron.job'::regclass, 'cron.job_run_details'::regclass) and not relrowsecurity)
  then
    raise exception 'booking_request_expiry_scheduler_config_unsupported';
  end if;
  perform cron.schedule('quicktrimr.request_expiry.primary', primary_seconds || ' seconds',
    'select private.run_booking_request_expiry(''primary'');');
  perform cron.schedule('quicktrimr.request_expiry.reconcile', reconcile_seconds || ' seconds',
    'select private.run_booking_request_expiry(''reconcile'');');
end;
$$;

revoke all on schema cron from public, anon, authenticated, service_role;
revoke all on all tables in schema cron from public, anon, authenticated, service_role;
revoke all on all functions in schema cron from public, anon, authenticated, service_role;
commit;
