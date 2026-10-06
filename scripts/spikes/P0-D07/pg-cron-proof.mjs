import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

// Isolated, reproducible lab. Never connects to an existing DB or loads a .env file.
const image = 'public.ecr.aws/supabase/postgres:17.6.1.167';
const restImage = 'public.ecr.aws/supabase/postgrest:v16.2';
const suffix = randomUUID().slice(0, 8);
const db = `quicktrimr-p0-d07-${suffix}`;
const rest = `${db}-rest`;
const label = `quicktrimr.spike=P0-D07-${suffix}`;
const testJwtSecret = randomUUID() + randomUUID();
const created = [];
let passed = 0;

function command(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout.trim())
      : reject(new Error(`docker ${args[0]} failed (${code}): ${stderr}`)));
    child.stdin.end(input);
  });
}
const sql = (query) => command(['exec', '-i', db, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], query);
const check = (name, evidence) => { passed++; console.log(JSON.stringify({ check: name, evidence })); };
async function until(predicate, timeoutMs, description) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await predicate()) return;
    await delay(250);
  }
  throw new Error(`Timed out: ${description}`);
}
function token(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role: 'authenticated', sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${header}.${payload}.${createHmac('sha256', testJwtSecret).update(`${header}.${payload}`).digest('base64url')}`;
}
async function api(path, method, bearer, body) {
  const args = ['exec', db, 'curl', '-sS', '-w', '\n%{http_code}', '-X', method,
    '-H', 'Content-Type: application/json', '-H', 'Prefer: return=representation'];
  if (bearer) args.push('-H', `Authorization: Bearer ${bearer}`);
  if (body) args.push('--data', JSON.stringify(body));
  args.push(`http://127.0.0.1:3000/${path}`);
  const output = await command(args);
  const boundary = output.lastIndexOf('\n');
  return { status: Number(output.slice(boundary + 1)), body: output.slice(0, boundary) };
}

try {
  await command(['run', '-d', '--name', db, '--label', label, '--network', 'none',
    '--tmpfs', '/tmp', '--user', 'postgres', '--entrypoint', 'sh', image, '-c',
    'initdb -D /tmp/spike-pg --auth=trust && exec postgres -D /tmp/spike-pg -c shared_preload_libraries=pg_cron -c cron.database_name=postgres -c cron.use_background_workers=on -c max_worker_processes=16 -c listen_addresses=localhost']);
  created.push(db);
  await until(async () => { try { return await sql('select 1;') === '1'; } catch { return false; } }, 30000, 'Postgres startup');
  await sql(await readFile(new URL('./fixture.sql', import.meta.url), 'utf8'));
  check('engine versions', JSON.parse(await sql("select json_build_object('postgres',version(),'pg_cron',(select extversion from pg_extension where extname='pg_cron'));")));

  // Real five-minute deadline; keep it running while accelerated proofs execute below.
  const expiryMinutes = Number((await readFile(new URL('../../../QUICKTRIMR_KNOWLEDGE_BASE.md', import.meta.url), 'utf8'))
    .split('\n').find((line) => line.startsWith('| `CFG-AVAIL-EXPIRY-MIN` |')).split('|')[2].replaceAll('`', '').trim());
  assert.equal(expiryMinutes, 5, 'Update the spike when the authoritative expiry policy changes');
  const realDeadline = await sql(`insert into spike.requests(id,due_at) values ('real-five-minute',clock_timestamp()+make_interval(mins=>${expiryMinutes})) returning due_at;`);
  await sql("select cron.schedule('real-expiry','1 second',$job$select spike.fire('real-five-minute',clock_timestamp());$job$);");
  console.log(JSON.stringify({ realFiveMinuteDeadline: realDeadline, temporaryContainer: db }));

  await sql("insert into spike.requests(id,due_at) values ('boundary','2026-10-03T12:05:00Z');");
  assert.equal(await sql("select spike.fire('boundary','2026-10-03T12:04:59.999Z');"), '0');
  assert.equal(await sql("select spike.fire('boundary','2026-10-03T12:05:00Z');"), '1');
  assert.equal(await sql("select spike.fire('boundary','2026-10-03T12:05:00.001Z');"), '0');
  check('exact deadline and duplicate delivery', '0 before / 1 at / 0 after');

  await sql("insert into spike.requests(id,due_at) values ('six-hour','2026-10-03T18:00:00Z');");
  const clockStart = performance.now();
  assert.equal(await sql("select spike.fire('six-hour','2026-10-03T17:59:59.999Z');"), '0');
  assert.equal(await sql("select spike.fire('six-hour','2026-10-03T18:00:00Z');"), '1');
  check('six-hour rule with private controlled clock', { elapsedMs: Math.round(performance.now() - clockStart) });

  for (let iteration = 0; iteration < 10; iteration++) {
    await sql(`insert into spike.requests(id,due_at) values ('race-${iteration}',clock_timestamp()-interval '1 second');`);
    const results = await Promise.all(Array.from({ length: 8 }, () => sql(`select spike.fire('race-${iteration}',clock_timestamp());`)));
    assert.equal(results.map(Number).reduce((sum, count) => sum + count, 0), 1);
  }
  check('real parallel duplicate fires', '10 rounds × 8 separate database sessions; exactly one effect per round');

  // Cancel a full-length deadline, then force a stale delivery after its due time.
  await sql(`insert into spike.requests(id,due_at) values ('cancelled',clock_timestamp()+make_interval(mins=>${expiryMinutes})); select cron.schedule('cancelled-expiry','1 second',$job$select spike.fire('cancelled',clock_timestamp());$job$);`);
  assert.equal(await sql("select spike.accept('cancelled'); select cron.unschedule('cancelled-expiry');"), '1\nt');
  assert.equal(await sql("select spike.fire('cancelled',due_at+interval '1 second') from spike.requests where id='cancelled';"), '0');
  assert.equal(await sql("select state from spike.requests where id='cancelled';"), 'accepted');
  check('accept cancels wake-up; stale delivery no-ops', 'accepted; zero expiry effects');

  // This mock has no acceptance policy: test atomicity, not who should win at a deadline.
  for (let iteration = 0; iteration < 10; iteration++) {
    const id = `accept-race-${iteration}`;
    await sql(`insert into spike.requests(id,due_at) values ('${id}',clock_timestamp()-interval '1 second');`);
    const results = await Promise.all([sql(`select spike.accept('${id}');`), sql(`select spike.fire('${id}',clock_timestamp());`)]);
    assert.equal(results.map(Number).reduce((sum, count) => sum + count, 0), 1);
    const outcome = JSON.parse(await sql(`select json_build_object('state',state,'effects',(select count(*) from spike.effects where request_id='${id}')) from spike.requests where id='${id}';`));
    assert.equal(outcome.effects, outcome.state === 'expired' ? 1 : 0);
  }
  check('concurrent accept versus expiry', '10 real parallel races; one committed outcome with matching effect history; no invented acceptance priority');

  // Deliberately omit a per-entity schedule. Reconciliation queries authoritative due rows.
  await sql("insert into spike.requests(id,due_at) values ('dropped',clock_timestamp()); select cron.schedule('reconciliation','1 second',$job$select spike.sweep(clock_timestamp());$job$);");
  await until(async () => await sql("select state from spike.requests where id='dropped';") === 'expired', 10000, 'dropped schedule reconciliation');
  assert.equal(await sql("select reason from spike.effects where request_id='dropped';"), 'reconciliation');
  await sql("select cron.unschedule('reconciliation');");
  check('dropped per-entity schedule recovered by real cron sweep', 'one reconciliation effect');

  // A stopped sweep misses ticks, not durable due rows. Restart must catch the backlog.
  await sql("insert into spike.requests(id,due_at) values ('outage',clock_timestamp());");
  await delay(1200);
  assert.equal(await sql("select state from spike.requests where id='outage';"), 'pending');
  await sql("select cron.schedule('restarted-sweep','1 second',$job$select spike.sweep(clock_timestamp());$job$);");
  await until(async () => await sql("select state from spike.requests where id='outage';") === 'expired', 10000, 'missed ticks recovery');
  await sql("select cron.unschedule('restarted-sweep');");
  check('sweep pause and restart recovery', 'pending during pause; one effect after restart');

  await sql("select cron.schedule('visible-failure','1 second','select 1/0;');");
  await until(async () => Number(await sql("select count(*) from cron.job_run_details d join cron.job j using(jobid) where j.jobname='visible-failure' and d.status='failed';")) > 0, 10000, 'cron failure history');
  await sql("select cron.unschedule('visible-failure');");
  check('failed run observable in cron history', 'division-by-zero run recorded as failed; external alert delivery not tested');

  await sql("insert into spike.requests(id,due_at) select 'load-'||n,clock_timestamp()-interval '1 second' from generate_series(1,1000)n; analyze spike.requests;");
  const plan = await sql("explain (analyze, buffers, format json) select id from spike.requests where state='pending' and due_at<=clock_timestamp() order by due_at,id limit 100;");
  assert.match(plan, /requests_due_pending/);
  const loadStart = performance.now();
  const batches = await Promise.all(Array.from({ length: 10 }, () => sql('select spike.sweep(clock_timestamp(),100);')));
  assert.equal(batches.map(Number).reduce((sum, count) => sum + count, 0), 1000);
  assert.equal(await sql("select count(*) from spike.effects where request_id like 'load-%';"), '1000');
  check('bounded indexed sweep under contention', { rows: 1000, historyRows: 100000, sessions: 10, elapsedMs: Math.round(performance.now() - loadStart), plan: JSON.parse(plan)[0] });

  await command(['run', '-d', '--name', rest, '--label', label, '--network', `container:${db}`,
    '-e', 'PGRST_DB_URI=postgres://authenticator@127.0.0.1:5432/postgres', '-e', 'PGRST_DB_SCHEMAS=spike',
    '-e', 'PGRST_DB_ANON_ROLE=anon', '-e', `PGRST_JWT_SECRET=${testJwtSecret}`, restImage]);
  created.push(rest);
  await until(async () => { try { return (await api('requests', 'GET')).status === 200; } catch { return false; } }, 20000, 'isolated PostgREST startup');
  const actors = [undefined, token('00000000-0000-4000-8000-000000000001'), token('00000000-0000-4000-8000-000000000002')];
  for (const actor of actors) {
    for (const table of ['requests', 'effects']) {
      assert.deepEqual(await api(table, 'GET', actor), { status: 200, body: '[]' });
      const insert = table === 'requests' ? { id: 'crafted', due_at: '2026-10-03T12:00:00Z' }
        : { request_id: 'boundary', reason: 'forged' };
      assert.ok([401, 403].includes((await api(table, 'POST', actor, insert)).status));
      assert.deepEqual(await api(table, 'PATCH', actor, table === 'requests' ? { state: 'accepted' } : { reason: 'forged' }), { status: 200, body: '[]' });
      assert.deepEqual(await api(table, 'DELETE', actor), { status: 200, body: '[]' });
    }
    assert.ok([401, 403, 404].includes((await api('rpc/sweep', 'POST', actor, { p_now: '2100-01-01T00:00:00Z' })).status));
    assert.ok([401, 403, 404].includes((await api('rpc/fire', 'POST', actor, { p_id: 'cancelled', p_now: '2100-01-01T00:00:00Z' })).status));
    assert.ok([401, 403, 404].includes((await api('rpc/accept', 'POST', actor, { p_id: 'real-five-minute' })).status));
  }
  assert.equal(await sql("select count(*) from spike.effects where request_id='boundary' and reason='delivery';"), '1');
  await assert.rejects(sql("update spike.effects set reason='changed' where request_id='boundary';"), /append-only/);
  check('API denial and immutable evidence', 'anon + two signed users: read/insert/update/delete denied; private sweep unavailable; effect mutation rejected');

  console.log('Waiting for the real five-minute deadline; polling reads do not fire the job.');
  await until(async () => await sql("select state from spike.requests where id='real-five-minute';") === 'expired', expiryMinutes * 60000 + 20000, 'real five-minute expiry');
  const realResult = JSON.parse(await sql("select json_build_object('dueAt',r.due_at,'appliedAt',e.applied_at,'reason',e.reason,'latenessMs',extract(epoch from(e.applied_at-r.due_at))*1000,'effects',(select count(*) from spike.effects where request_id=r.id)) from spike.requests r join spike.effects e on e.request_id=r.id where r.id='real-five-minute';"));
  assert.ok(realResult.latenessMs >= 0 && realResult.latenessMs < 60000);
  assert.equal(realResult.effects, 1);
  assert.equal(realResult.reason, 'delivery');
  check('real five-minute pg_cron expiry', realResult);
  console.log(JSON.stringify({ result: 'PASS', checks: passed, image, restImage }));
} finally {
  // Remove only containers created by this run; validate labels before cleanup.
  for (const name of created.reverse()) {
    const actual = await command(['inspect', name, '--format', '{{index .Config.Labels "quicktrimr.spike"}}']);
    assert.equal(actual, `P0-D07-${suffix}`);
    await command(['rm', '-f', name]);
    console.log(`Removed disposable synthetic-data container ${name}`);
  }
}
