import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { commandArgs, runLocal } from './local.mjs';

test('migration apply and reset always select the local database', () => {
  assert.deepEqual(commandArgs('reset'), ['db', 'reset', '--local']);
  assert.deepEqual(commandArgs('migrate'), ['migration', 'up', '--local']);
  assert.deepEqual(commandArgs('stop'), ['stop', '--project-id', 'quicktrimr']);
});

test('local runner rejects remote targets, unknown flags and extra arguments before calling a child', () => {
  for (const command of ['start', 'stop', 'reset', 'migrate']) {
    for (const args of [
      ['--linked'],
      ['--db-url', 'postgres://remote'],
      ['--all'],
      ['--no-backup'],
      ['unexpected'],
    ]) {
      let called = false;
      assert.throws(() =>
        runLocal(command, args, {
          run: () => {
            called = true;
          },
        }),
      );
      assert.equal(called, false);
    }
  }
  assert.throws(() => commandArgs('push'));
});

test('migration names cannot inject flags, paths or shell arguments', () => {
  assert.deepEqual(commandArgs('new', ['add_booking_index']), [
    'migration',
    'new',
    'add_booking_index',
  ]);
  for (const args of [
    [],
    ['--linked'],
    ['../outside'],
    ['name; command'],
    ['two', 'names'],
    ['UPPERCASE'],
    [''],
  ])
    assert.throws(() => commandArgs('new', args));
});

test('function serve keeps JWT verification enabled and defaults to the credential-free template', () => {
  assert.deepEqual(commandArgs('serve'), [
    'functions',
    'serve',
    '--env-file',
    'supabase/.env.example',
  ]);
  assert.deepEqual(
    commandArgs('serve', ['--env-file', 'supabase/.env.local']),
    ['functions', 'serve', '--env-file', 'supabase/.env.local'],
  );
  for (const args of [
    ['--no-verify-jwt'],
    ['--env-file', '/outside'],
    ['--env-file'],
    ['--debug'],
  ])
    assert.throws(() => commandArgs('serve', args));
});

test('local execution drops hosted credentials and suppresses CLI key output', () => {
  const env = {
    PATH: process.env.PATH,
    SUPABASE_ACCESS_TOKEN: 'synthetic',
    SUPABASE_DB_PASSWORD: 'synthetic',
    SUPABASE_DB_URL: 'synthetic',
    SUPABASE_PROJECT_REF: 'synthetic',
    SUPABASE_PROJECT_ID: 'another-project',
    SUPABASE_API_PORT: '54321',
  };
  const status = runLocal('reset', [], {
    env,
    run: (_binary, args, options) => {
      assert.deepEqual(args, ['db', 'reset', '--local']);
      assert.deepEqual(options.env, { PATH: process.env.PATH });
      assert.deepEqual(options.stdio, ['ignore', 'ignore', 'inherit']);
      return { status: 0 };
    },
  });
  assert.equal(status, 0);
  assert.equal(env.SUPABASE_ACCESS_TOKEN, 'synthetic');
});

test('local execution propagates an actual subprocess failure', () => {
  const status = runLocal('migrate', [], {
    run: () => spawnSync(process.execPath, ['-e', 'process.exit(9)']),
  });
  assert.equal(status, 9);
  assert.equal(
    runLocal('migrate', [], {
      run: () => ({ status: null, signal: 'SIGTERM' }),
    }),
    1,
  );
  assert.throws(() =>
    runLocal('migrate', [], { run: () => ({ error: new Error('missing') }) }),
  );
});
