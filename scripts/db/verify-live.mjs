import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { projectId, root, runLocal } from './local.mjs';
import { queryLocal, verifyPostgis } from './verify.mjs';

function schemaFingerprint() {
  const dump = spawnSync(
    'docker',
    [
      'exec',
      `supabase_db_${projectId}`,
      'pg_dump',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '--schema-only',
      '--no-owner',
      '--no-privileges',
      '--schema=public',
      '--schema=extensions',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(dump.status, 0, 'Local schema dump failed.');
  // Newer pg_dump adds a random psql restriction nonce; it is not schema state.
  const schema = dump.stdout.replace(/^\\(?:un)?restrict .*\n/gm, '');
  return createHash('sha256').update(schema).digest('hex');
}

function localStatus() {
  const status = spawnSync(
    resolve(root, 'node_modules/.bin/supabase'),
    ['status', '--output', 'json'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(status.status, 0, 'Could not obtain local stack status.');
  try {
    return JSON.parse(status.stdout);
  } catch {
    throw new Error('Local status was not JSON; credential values suppressed.');
  }
}

async function checkProbe() {
  const status = localStatus();
  const url = new URL('/functions/v1/workspace-contract', status.API_URL);
  assert.equal(
    url.origin,
    'http://127.0.0.1:55321',
    'Refusing a non-QuickTrimr local API.',
  );
  assert.ok(
    typeof status.ANON_KEY === 'string',
    'Local anon JWT is unavailable.',
  );
  const server = spawn(
    process.execPath,
    [resolve(root, 'scripts/db/local.mjs'), 'serve'],
    { cwd: root, stdio: 'ignore', detached: true },
  );
  let spawnFailed = false;
  server.on('error', () => {
    spawnFailed = true;
  });
  const request = (options) =>
    fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
  const authorization = `Bearer ${status.ANON_KEY}`;
  try {
    let response;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (spawnFailed || server.exitCode !== null)
        throw new Error('Local function server exited before verification.');
      try {
        response = await request({ headers: { authorization } });
        if (response.status === 200) break;
      } catch {
        // Cold runtime startup is retried for this development probe only.
      }
      await setTimeout(500);
    }
    assert.equal(
      response?.status,
      200,
      'Local foundation probe did not become ready.',
    );
    assert.deepEqual(await response.json(), {
      product: 'QuickTrimr',
      surface: 'function',
    });
    assert.equal((await request()).status, 401, 'Missing JWT was not denied.');
    assert.equal(
      (await request({ headers: { authorization: 'Bearer forged.jwt.value' } }))
        .status,
      401,
      'Forged JWT was not denied.',
    );
    const invalidMethod = await request({
      method: 'POST',
      headers: { authorization },
      body: '{}',
    });
    assert.equal(invalidMethod.status, 405);
    assert.equal(invalidMethod.headers.get('allow'), 'GET');
    assert.deepEqual(await invalidMethod.json(), { error: 'Use GET.' });
    console.log(
      'Edge runtime: PASS (shared identity 200, missing JWT 401, forged JWT 401, POST 405).',
    );
  } finally {
    // Stop only the server process group this verifier created, including its CLI child.
    if (server.pid && server.exitCode === null)
      process.kill(-server.pid, 'SIGTERM');
  }
}

try {
  assert.deepEqual(
    process.argv.slice(2),
    ['--allow-local-reset'],
    'This check erases QuickTrimr local DB data. Use db:test:live --allow-local-reset only on a disposable local stack.',
  );
  verifyPostgis(); // Confirm the named local container and extension exist before resetting.
  const expected = (await readdir(resolve(root, 'supabase/migrations')))
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .map((name) => name.slice(0, 14))
    .sort()
    .join('\n');
  assert.equal(runLocal('reset'), 0, 'First local reset failed.');
  const first = schemaFingerprint();
  assert.equal(
    queryLocal(
      'select version from supabase_migrations.schema_migrations order by version;',
    ),
    expected,
  );
  assert.equal(runLocal('reset'), 0, 'Second local reset failed.');
  assert.equal(
    schemaFingerprint(),
    first,
    'Migrations did not reproduce the same schema.',
  );
  assert.equal(
    queryLocal(
      'select version from supabase_migrations.schema_migrations order by version;',
    ),
    expected,
  );
  const { version, distance } = verifyPostgis();
  console.log(
    `Reset replay: PASS (two identical schema fingerprints: ${first}).`,
  );
  console.log(
    `Migration history: PASS (${expected.split('\n').length} migrations).`,
  );
  console.log(version);
  console.log(`PostGIS geography: PASS (${distance} metres).`);
  await checkProbe();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Live local verification failed.',
  );
  process.exitCode = 1;
}
