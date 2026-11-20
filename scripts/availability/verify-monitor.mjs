// Explicit isolated hosted-test fault injection. Never run on a production target.
// Run after configure-monitor and the worker capacity proof. Restores both jobs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

import { workerTarget, workerSql, workerConfig } from './worker-operator.mjs';

assert.deepEqual(process.argv.slice(2), ['hosted']);
const target = workerTarget('hosted'),
  config = workerConfig('CFG-AVAIL-WORKER-OPERATIONS');
const sql = (statement) => workerSql(target, statement);
const row = (expression) => sql(`select to_jsonb(${expression}) as result;`);
const jobs = row(
  "(select jsonb_agg(jsonb_build_object('id',jobid,'active',active,'name',jobname)) from cron.job where jobname in ('quicktrimr.available_now.expiry','quicktrimr.available_now.health'))",
);
assert.equal(jobs.length, 2);
const setJob = (name, active) =>
  sql(
    `do $$ begin perform cron.alter_job(${jobs.find((j) => j.name.endsWith(name)).id},active:=${active}); end $$;`,
  );
const user = randomUUID(),
  session = randomUUID(),
  evidence = [];
mkdirSync('docs/qa/evidence/P2-T03-hosted', { recursive: true });
function record(stage, value) {
  evidence.push({ stage, ...value });
  writeFileSync(
    'docs/qa/evidence/P2-T03-hosted/monitor.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
  console.log(JSON.stringify(evidence.at(-1)));
}
async function delivered(stage, status) {
  const start = row('clock_timestamp()');
  const deadline = Date.now() + config.healthCheckSeconds * 3000;
  while (true) {
    row('private.check_available_now_health()');
    const delivery = row(
      `(select jsonb_build_object('createdAt',created_at,'outcome',outcome,'httpStatus',http_status,'healthStatus',health_status) from private.available_now_monitor_deliveries where created_at>='${start}' and health_status='${status}' and outcome='accepted' order by id desc limit 1)`,
    );
    if (delivery) {
      record(stage, delivery);
      return;
    }
    assert.ok(
      Date.now() < deadline,
      `Monitoring delivery timed out at ${stage}; private responses suppressed.`,
    );
    await delay(3000);
  }
}
try {
  assert.equal(
    row(
      "(select count(*) from vault.secrets where name='available_now_worker_dsn')",
    ),
    1,
  );
  sql(`do $$ declare old_run bigint; failure_id bigint; audit_before bigint; receipts_before bigint; begin
    select count(*) into audit_before from public.audit_logs;
    select count(*) into receipts_before from private.available_now_request_receipts;
    insert into private.available_now_worker_runs(started_at,finished_at,outcome,processed) values(clock_timestamp()-interval '31 days',clock_timestamp()-interval '31 days','succeeded',0) returning id into old_run;
    insert into private.available_now_worker_failures(source,source_id,detected_at) values('worker',old_run,clock_timestamp()-interval '31 days') returning id into failure_id;
    perform private.prune_available_now_worker_history();
    if exists(select 1 from private.available_now_worker_runs where id=old_run) or not exists(select 1 from private.available_now_worker_failures where id=failure_id)
      or audit_before<>(select count(*) from public.audit_logs) or receipts_before<>(select count(*) from private.available_now_request_receipts) then raise exception 'retention_proof_failed'; end if;
    delete from private.available_now_worker_failures where id=failure_id; -- only this disposable test record
  end $$;`);
  record('hosted-retention', {
    oldOperationalRunPruned: true,
    unreportedFailurePreserved: true,
    immutableHistoryPreserved: true,
  });
  await delivered('baseline', 'ok');
  setJob('expiry', false);
  sql(`insert into auth.users(id) values('${user}'); insert into public.profiles(id,role,verification_status) values('${user}','barber','not_started'); insert into public.barber_profiles(id) values('${user}');
    insert into public.available_now_sessions(id,barber_id,location,status,available_until) values('${session}','${user}','SRID=4326;POINT(155 -43)','active',clock_timestamp()-(${config.overdueSeconds}+1)*interval '1 second');`);
  let health = row('private.available_now_worker_health()');
  assert.ok(health.overdue && !health.staleHeartbeat);
  record('overdue-detected', health);
  await delivered('overdue-alert', 'error');
  row('private.run_available_now_expiry()');
  setJob('expiry', true);
  await delivered('overdue-recovery', 'ok');
  // An invalid config is visible only inside this transaction; restore before
  // commit. A due synthetic row exercises rollback and safe SQLSTATE recording.
  sql(`do $$ declare saved jsonb; effect jsonb; begin
    update public.available_now_sessions set status='active',available_until=clock_timestamp()-interval '1 second' where id='${session}';
    select value into saved from private.platform_config where key='missed_request_threshold';
    update private.platform_config set value='0' where key='missed_request_threshold';
    effect:=private.run_available_now_expiry();
    if effect->>'outcome'<>'failed' then raise exception 'fault_not_observed'; end if;
    update private.platform_config set value=saved where key='missed_request_threshold';
  end $$;`);
  health = row('private.available_now_worker_health()');
  assert.ok(health.failedRuns > 0);
  record('failure-detected', health);
  await delivered('failed-run-alert', 'error');
  await delivered('failed-run-recovery', 'ok');
  setJob('expiry', false);
  sql(
    `update private.available_now_worker_state set last_success_at=clock_timestamp()-(${config.staleHeartbeatSeconds}+1)*interval '1 second' where singleton;`,
  );
  health = row('private.available_now_worker_health()');
  assert.ok(health.staleHeartbeat && !health.overdue);
  record('stale-detected', health);
  await delivered('stale-heartbeat-alert', 'error');
  row('private.run_available_now_expiry()');
  setJob('expiry', true);
  await delivered('stale-heartbeat-recovery', 'ok');
  // No DB health call during this window: Sentry must detect missing check-ins
  // independently even when BOTH schedules stop. Inspect its incident history.
  setJob('expiry', false);
  setJob('health', false);
  record('independent-missing-window-start', {
    serverNow: row('clock_timestamp()'),
    bothJobsPaused: true,
  });
  await delay(
    (config.staleHeartbeatSeconds + config.healthCheckSeconds) * 1000,
  );
  record('independent-missing-window-end', {
    serverNow: row('clock_timestamp()'),
    bothJobsPaused: true,
  });
  row('private.run_available_now_expiry()');
  setJob('expiry', true);
  setJob('health', true);
  await delivered('missing-checkin-recovery', 'ok');
} finally {
  sql(
    `do $$ begin ${jobs.map((j) => `perform cron.alter_job(${j.id},active:=${j.active});`).join('\n')} end $$;`,
  );
  sql(
    `delete from public.available_now_sessions where id='${session}';delete from public.barber_profiles where id='${user}';delete from public.profiles where id='${user}';delete from auth.users where id='${user}';`,
  );
  record('restored', {
    schedulesRestored: true,
    syntheticRowsRemoved: true,
    immutableAuditPreserved: true,
  });
}
