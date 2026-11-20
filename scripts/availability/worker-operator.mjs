import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { sqlValue } from '../db/core-fixtures.mjs';
import { localStatus } from '../db/local-api.mjs';
import { root } from '../db/local.mjs';

const cli = resolve(root, 'node_modules/.bin/supabase');
export function workerConfig(id) {
  const line = readFileSync(
    resolve(root, 'QUICKTRIMR_KNOWLEDGE_BASE.md'),
    'utf8',
  )
    .split('\n')
    .find((line) => line.startsWith(`| \`${id}\` |`));
  const value = line?.split(' | ')[1]?.match(/^`(.+)`$/)?.[1];
  assert.ok(value, `Missing worker configuration ${id}.`);
  return value.startsWith('{') ? JSON.parse(value) : value;
}
function cliJson(args) {
  try {
    return JSON.parse(
      execFileSync(cli, args, {
        cwd: root,
        encoding: 'utf8',
        timeout: 60000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  } catch {
    throw new Error(
      'QuickTrimr operator command failed; SQL, credentials and raw output suppressed.',
    );
  }
}
export function assertWorkerTarget(projects, linkedRef, expected) {
  assert.ok(
    linkedRef === expected.projectRef,
    'Refusing an unapproved linked project.',
  );
  assert.ok(
    projects.some(
      (p) =>
        p.id === expected.projectRef &&
        p.organization_id === expected.organizationId &&
        p.status === 'ACTIVE_HEALTHY',
    ),
    'Customer project identity/access check failed.',
  );
}
export function workerTarget(name) {
  assert.ok(
    ['local', 'hosted'].includes(name),
    'Use exactly local or hosted; no target overrides.',
  );
  if (name === 'local') return { name, api: localStatus() };
  const expected = workerConfig('CFG-AVAIL-WORKER-TEST-PROJECT');
  const projects = cliJson(['projects', 'list', '--output', 'json']);
  const linked = readFileSync(
    resolve(root, 'supabase/.temp/project-ref'),
    'utf8',
  ).trim();
  assertWorkerTarget(projects, linked, expected);
  return { name, expected };
}
export function workerSql(target, sql) {
  if (target.name === 'local') {
    let output;
    try {
      output = execFileSync(
        'docker',
        [
          'exec',
          '-i',
          'supabase_db_quicktrimr',
          'psql',
          '-XqAt',
          '-U',
          'postgres',
          '-d',
          'postgres',
          '-v',
          'ON_ERROR_STOP=1',
        ],
        {
          input: sql,
          encoding: 'utf8',
          timeout: 60000,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      ).trim();
    } catch {
      throw new Error(
        'Local worker SQL failed; SQL and private output suppressed.',
      );
    }
    try {
      return output ? JSON.parse(output) : null;
    } catch {
      throw new Error(
        'Unexpected local SQL result format; private data suppressed.',
      );
    }
  }
  assert.ok(
    readFileSync(resolve(root, 'supabase/.temp/project-ref'), 'utf8').trim() ===
      target.expected.projectRef,
    'Linked target changed.',
  );
  const directory = mkdtempSync(resolve(tmpdir(), 'quicktrimr-worker-sql-'));
  try {
    const file = resolve(directory, 'operation.sql');
    writeFileSync(file, sql, { mode: 0o600 });
    const response = cliJson([
      'db',
      'query',
      '--linked',
      '--file',
      file,
      '--agent=yes',
      '--output',
      'json',
    ]);
    assert.ok(Array.isArray(response.rows), 'Invalid hosted SQL envelope.');
    if (response.rows.length === 0) return null;
    assert.equal(response.rows.length, 1, 'Unexpected operator row count.');
    if (/^\s*explain(?:\s|\()/i.test(sql)) {
      assert.ok(
        Array.isArray(response.rows[0]['QUERY PLAN']),
        'Invalid query-plan response.',
      );
      return response.rows[0]['QUERY PLAN'];
    }
    assert.ok(
      Object.hasOwn(response.rows[0], 'result'),
      'Operator query requires a result column.',
    );
    return response.rows[0].result;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
export function workerApi(target) {
  if (target.name === 'local') return target.api;
  const keys = cliJson([
    'projects',
    'api-keys',
    '--project-ref',
    target.expected.projectRef,
    '--output',
    'json',
  ]);
  const status = {
    API_URL: `https://${target.expected.projectRef}.supabase.co`,
    ANON_KEY: keys.find((k) => k.name === 'anon')?.api_key,
    SERVICE_ROLE_KEY: keys.find((k) => k.name === 'service_role')?.api_key,
  };
  assert.ok(
    status.ANON_KEY && status.SERVICE_ROLE_KEY,
    'Expected hosted test credentials are unavailable.',
  );
  return status; // Keys stay in memory; never print this object.
}
export async function workerRequest(api, path, token, options = {}) {
  const url = new URL(path, api.API_URL);
  assert.equal(
    url.origin,
    api.API_URL,
    'Refusing a cross-origin worker test request.',
  );
  assert.ok(
    /^\/(auth|rest|functions)\/v1\//.test(url.pathname),
    'Unsupported worker test API.',
  );
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: api.ANON_KEY,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
      ...options.headers,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  const body =
    response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, body }; // Caller assertions must suppress private bodies.
}
function configureMonitor(target) {
  const line = readFileSync(resolve(root, 'supabase/.env.local'), 'utf8')
    .split('\n')
    .find((l) => l.startsWith('SENTRY_WORKER_DSN='));
  const dsn = line
    ?.slice('SENTRY_WORKER_DSN='.length)
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2');
  assert.ok(
    dsn,
    'Missing SENTRY_WORKER_DSN in the ignored backend environment.',
  );
  const monitor = workerConfig('CFG-AVAIL-WORKER-MONITOR');
  validateWorkerDsn(dsn, monitor);
  const existing = workerSql(
    target,
    `select jsonb_build_object('count',count(*),'matches',coalesce(bool_and(decrypted_secret=${sqlValue(dsn)}),true)) as result from vault.decrypted_secrets where name='available_now_worker_dsn';`,
  );
  assert.ok(
    existing.count <= 1 && existing.matches,
    'An existing monitor credential requires review; refusing rotation.',
  );
  if (existing.count === 0)
    workerSql(
      target,
      `select jsonb_build_object('stored',vault.create_secret(${sqlValue(dsn)},'available_now_worker_dsn') is not null) as result;`,
    );
  return {
    configured: true,
    organization: monitor.organizationSlug,
    project: monitor.projectSlug,
  };
}
export function validateWorkerDsn(dsn, monitor) {
  let parsed;
  try {
    parsed = new URL(dsn);
  } catch {
    throw new Error('Invalid monitoring credential format.');
  }
  assert.ok(
    parsed.hostname === monitor.ingestHost,
    'Refusing a different monitoring organization.',
  );
  assert.ok(
    parsed.pathname === `/${monitor.projectId}`,
    'Refusing a different monitoring project.',
  );
  assert.ok(
    parsed.protocol === 'https:' &&
      /^[a-f0-9]+$/.test(parsed.username) &&
      !parsed.password &&
      !parsed.port &&
      !parsed.search &&
      !parsed.hash,
    'Invalid monitoring credential format.',
  );
  return parsed;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    assert.equal(
      process.argv.length,
      4,
      'Usage: worker-operator.mjs local|hosted install|configure-monitor|status',
    );
    const target = workerTarget(process.argv[2]);
    switch (process.argv[3]) {
      case 'install':
        workerSql(
          target,
          readFileSync(
            resolve(root, 'supabase/operations/available-now-worker.sql'),
            'utf8',
          ),
        );
        console.log(
          'Available Now schedules and server-only permissions installed.',
        );
        break;
      case 'configure-monitor':
        console.log(JSON.stringify(configureMonitor(target)));
        break;
      case 'status':
        console.log(
          JSON.stringify(
            workerSql(
              target,
              'select private.available_now_worker_health() as result;',
            ),
          ),
        );
        break;
      default:
        throw new Error('Unsupported worker operation.');
    }
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Worker operator failed.',
    );
    process.exitCode = 1;
  }
}
