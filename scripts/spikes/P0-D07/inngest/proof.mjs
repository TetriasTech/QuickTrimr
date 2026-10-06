import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Inngest } from 'inngest';
import { serve } from 'inngest/node';

// SDK/scheduler smoke test only. Memory fixtures are NOT a durability or RLS proof.
// The separate PostgreSQL proof owns transaction, concurrency and API-denial evidence.
async function unusedPort() {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  return port;
}
const port = await unusedPort();
const gatewayPort = await unusedPort();
const gatewayGrpcPort = await unusedPort();
const executorGrpcPort = await unusedPort();
const baseUrl = `http://127.0.0.1:${port}`;
const client = new Inngest({ id: 'quicktrimr-p0-d07-lab', isDev: true, baseUrl, eventKey: 'local-only' });
const rows = new Map();
const started = new Set();
const deliveries = [];
function fire(id) {
  const row = rows.get(id);
  deliveries.push({ id, wakeOffsetMs: row ? Date.now() - row.dueAt : null });
  if (!row || row.state !== 'pending' || Date.now() < row.dueAt) return 0;
  row.state = 'expired';
  row.effects++;
  row.latenessMs = Date.now() - row.dueAt;
  return 1;
}
const expiry = client.createFunction({
  id: 'expiry', triggers: { event: 'lab/request.created' },
  cancelOn: [{ event: 'lab/request.accepted', if: 'async.data.id == event.data.id' }],
}, async ({ event, step }) => {
  await step.run('started', () => { started.add(event.data.id); return true; });
  await step.sleepUntil('deadline', event.data.dueAt);
  return step.run('conditional-effect', () => fire(event.data.id));
});
const reconcile = client.createFunction({ id: 'reconcile', triggers: { event: 'lab/reconcile' } }, async ({ step }) =>
  step.run('due-rows', () => [...rows.keys()].reduce((count, id) => count + fire(id), 0)));
const server = createServer(serve({ client, functions: [expiry, reconcile] }));
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const appUrl = `http://127.0.0.1:${server.address().port}/api/inngest`;
const cli = spawn(fileURLToPath(new URL('./node_modules/.bin/inngest', import.meta.url)), [
  'dev', '--host', '127.0.0.1', '--port', String(port), '--no-discovery', '--no-poll',
  '--connect-gateway-port', String(gatewayPort), '--connect-gateway-grpc-port', String(gatewayGrpcPort),
  '--connect-executor-grpc-port', String(executorGrpcPort),
  '-u', appUrl,
], { cwd: fileURLToPath(new URL('.', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'],
  env: { PATH: process.env.PATH, INNGEST_DEV: '1' } });
let cliLogs = '';
cli.stdout.on('data', (chunk) => { cliLogs = (cliLogs + chunk).slice(-12000); });
cli.stderr.on('data', (chunk) => { cliLogs = (cliLogs + chunk).slice(-12000); });
let startupError;
cli.on('error', (error) => { startupError = error; });
async function until(predicate, description, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (startupError) throw startupError;
    if (cli.exitCode !== null) throw new Error(`Dev server exited: ${cliLogs}`);
    if (await predicate()) return;
    await delay(200);
  }
  throw new Error(`Timed out: ${description}\n${cliLogs}`);
}
async function runs(eventId) {
  const response = await fetch(`${baseUrl}/v1/events/${eventId}/runs`, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  return (await response.json()).data;
}
const eventFor = (id) => ({ name: 'lab/request.created', data: { id, dueAt: new Date(rows.get(id).dueAt).toISOString() } });
try {
  await until(async () => {
    try { return (await fetch(baseUrl, { signal: AbortSignal.timeout(1000) })).ok; }
    catch { return false; }
  }, 'local development server');
  // Explicit registration avoids relying on discovery or its polling interval.
  const sync = await fetch(appUrl, { method: 'PUT', signal: AbortSignal.timeout(5000) });
  assert.equal(sync.status, 200, await sync.text());

  for (let n = 0; n < 10; n++) rows.set(`timing-${n}`, { state: 'pending', dueAt: Date.now() + 5000 + n * 100, effects: 0 });
  const timingEvents = await client.send([...rows.keys()].map(eventFor));
  await until(() => deliveries.length === 10, 'ten real sleeps');
  const wakeOffsets = deliveries.map((delivery) => delivery.wakeOffsetMs).sort((a, b) => a - b);
  assert.ok(wakeOffsets.every((ms) => Math.abs(ms) < 60000));
  const earlyWakeups = deliveries.filter((delivery) => delivery.wakeOffsetMs < 0);
  assert.ok(earlyWakeups.every(({ id }) => rows.get(id).effects === 0), 'Never act before the authoritative deadline');
  await until(() => Date.now() >= Math.max(...[...rows.values()].map((row) => row.dueAt)), 'latest authoritative deadline');
  await client.send({ name: 'lab/reconcile', data: {} });
  await until(() => [...rows.values()].every((row) => row.state === 'expired'), 'reconcile any early wake-ups');
  assert.ok([...rows.values()].every((row) => row.effects === 1));
  console.log(JSON.stringify({ check: 'real local Inngest sleepUntil', samples: 10, wakeOffsetsMs: wakeOffsets, earlyWakeups: earlyWakeups.length, earlyEffects: 0, finalEffects: 10, recovery: 'explicit reconciliation event' }));

  await until(async () => (await runs(timingEvents.ids[0])).some((run) => run.status === 'Completed'), 'completed run API evidence');
  console.log(JSON.stringify({ check: 'run observability', status: 'Completed', endpoint: '/v1/events/:id/runs' }));
  const beforeReplay = deliveries.length;
  await client.send(eventFor('timing-0')); // Fresh event, same business operation.
  await until(() => deliveries.length > beforeReplay, 'duplicate delivery');
  assert.equal(rows.get('timing-0').effects, 1);
  console.log(JSON.stringify({ check: 'fresh duplicate event', effects: 1, storage: 'memory fixture, not a database concurrency proof' }));

  rows.set('cancelled', { state: 'pending', dueAt: Date.now() + 30000, effects: 0 });
  const cancellationEvent = await client.send(eventFor('cancelled'));
  await until(() => started.has('cancelled'), 'cancelled workflow started');
  rows.get('cancelled').state = 'accepted';
  await client.send({ name: 'lab/request.accepted', data: { id: 'cancelled' } });
  await until(async () => (await runs(cancellationEvent.ids[0])).some((run) => run.status === 'Cancelled'), 'cancellation run status');
  assert.equal(rows.get('cancelled').effects, 0);
  console.log(JSON.stringify({ check: 'matched cancellation event', status: 'Cancelled', effects: 0 }));

  rows.set('dropped', { state: 'pending', dueAt: Date.now() - 1000, effects: 0 });
  await client.send({ name: 'lab/reconcile', data: {} });
  await until(() => rows.get('dropped').state === 'expired', 'reconciliation handler');
  assert.equal(rows.get('dropped').effects, 1);
  console.log(JSON.stringify({ check: 'dropped event recovered', effects: 1, trigger: 'manual event; periodic cron delivery not tested here' }));
  console.log(JSON.stringify({ result: 'PASS', sdk: '4.21.1', cli: '1.45.1', productionTimingAndPersistence: 'NOT TESTED' }));
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  if (cli.exitCode === null && !startupError) {
    const exited = once(cli, 'exit');
    cli.kill('SIGTERM');
    const force = setTimeout(() => cli.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(force);
  }
  console.log('Stopped this proof’s local SDK server and Inngest child process.');
}
