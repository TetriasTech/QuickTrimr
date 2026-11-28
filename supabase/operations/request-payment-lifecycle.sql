-- Local approved Stripe test environment. Reuse the service credential used
-- by the financial reconciliation worker. The gateway is intentionally local.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function private.dispatch_request_payment_sweep() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  credential text;
  timeout_ms integer := (private.booking_request_expiry_config()->>'reconcileSeconds')::integer * 1000;
begin
  select decrypted_secret into credential from vault.decrypted_secrets where name='stripe_financial_worker_jwt';
  if credential is null then raise exception 'request_payment_worker_not_configured'; end if;
  return net.http_post(
    url := 'http://supabase_kong_quicktrimr:8000/functions/v1/capture-authorised-payment/sweep',
    headers := jsonb_build_object('Authorization','Bearer '||credential,'Content-Type','application/json'),
    body := '{}'::jsonb, timeout_milliseconds := timeout_ms
  );
end
$$;
revoke all on function private.dispatch_request_payment_sweep() from public,anon,authenticated,service_role;

do $$
declare seconds integer := (private.booking_request_expiry_config()->>'sweepSeconds')::integer;
begin
  if current_database() <> 'postgres' or not coalesce(seconds between 1 and 59, false) then
    raise exception 'request_payment_scheduler_unsupported';
  end if;
  perform cron.schedule('quicktrimr.request_payments',seconds||' seconds',
    'select private.dispatch_request_payment_sweep();');
end
$$;
revoke all on schema cron,vault from public,anon,authenticated,service_role;
revoke all on all tables in schema cron,vault from public,anon,authenticated,service_role;
revoke all on all functions in schema cron from public,anon,authenticated,service_role;
commit;
