import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { root } from './local.mjs';

export function localStatus() {
  const env = { ...process.env };
  for (const name of Object.keys(env))
    if (name.startsWith('SUPABASE_')) delete env[name];
  const status = spawnSync(
    resolve(root, 'node_modules/.bin/supabase'),
    ['status', '--output', 'json'],
    { cwd: root, encoding: 'utf8', env },
  );
  assert.equal(status.status, 0, 'Could not obtain local stack status.');
  let parsed;
  try {
    parsed = JSON.parse(status.stdout);
  } catch {
    throw new Error('Local status was not JSON; credential values suppressed.');
  }
  assert.equal(
    parsed.API_URL,
    'http://127.0.0.1:55321',
    'Refusing a non-QuickTrimr local API.',
  );
  return parsed; // Keys stay in memory; never log this object or headers.
}
