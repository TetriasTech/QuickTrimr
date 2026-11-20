import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { assertLocalProject, root } from '../db/local.mjs';
assert.equal(process.argv.length, 2, 'No file or target overrides.');
assertLocalProject();
const file = resolve(root, 'supabase/.env.discovery.local');
if (existsSync(file))
  console.log(
    'Discovery-only environment already exists; credential preserved.',
  );
else {
  const source = readFileSync(resolve(root, 'supabase/.env.example'), 'utf8');
  assert.match(source, /^DISCOVERY_CURSOR_KEY=$/m);
  writeFileSync(
    file,
    source.replace(
      /^DISCOVERY_CURSOR_KEY=$/m,
      'DISCOVERY_CURSOR_KEY=' + randomBytes(32).toString('base64'),
    ),
    { mode: 0o600, flag: 'wx' },
  );
  console.log(
    'Created ignored discovery-only environment; credential not printed.',
  );
}
