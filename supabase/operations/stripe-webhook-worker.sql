-- Install as postgres on the local QuickTrimr stack after saving the service JWT in Vault.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function private.dispatch_stripe_financial_sweep() returns bigint
language plpgsql security definer set search_path='' as $$
declare
  credential text;
  timeout_ms integer;
begin
  select decrypted_secret into credential from vault.decrypted_secrets where name='stripe_financial_worker_jwt';
  if credential is null then
    raise exception 'stripe_financial_worker_not_configured';
  end if;
  -- The worker lease is backed by the first approved retry interval.
  select (value->'retryMinutes'->>0)::integer * 60000 into strict timeout_ms
    from private.platform_config where key='stripe_webhook_worker';
  -- Bind the test credential to the local gateway for the configured project.
  return net.http_post(url:='http://supabase_kong_quicktrimr:8000/functions/v1/stripe-webhook/sweep',
    headers:=jsonb_build_object('Authorization','Bearer '||credential, 'Content-Type','application/json'),
    body:='{}'::jsonb, timeout_milliseconds:=timeout_ms);
end $$;
revoke all on function private.dispatch_stripe_financial_sweep() from public,anon,authenticated,service_role;

do $$
declare
  seconds integer;
begin
  select (value->>'sweepSeconds')::integer into strict seconds
    from private.platform_config where key='stripe_webhook_worker';
  if current_database()<>'postgres' or seconds not between 1 and 59
    or exists(select from pg_class where oid in ('cron.job'::regclass,'cron.job_run_details'::regclass)
      and not relrowsecurity) then
    raise exception 'stripe_financial_worker_schedule_unsupported';
  end if;
  perform cron.schedule('quicktrimr.stripe_financial_webhooks',seconds||' seconds',
    'select private.dispatch_stripe_financial_sweep();');
end $$;
revoke all on schema cron,vault from public,anon,authenticated,service_role;
revoke all on all tables in schema cron,vault from public,anon,authenticated,service_role;
-- Vault's crypto functions are provider-owned and remain behind its schema.
revoke all on all functions in schema cron from public,anon,authenticated,service_role;
commit;
