import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { localStatus } from './local-api.mjs';
import { assertLocalProject } from './local.mjs';
import { renderSeed, seedPath } from './seed-data.mjs';
import { queryLocal } from './verify.mjs';

export function applySeed(
  args = [],
  { status = localStatus, query = queryLocal } = {},
) {
  assert.equal(
    args.length,
    0,
    'db:seed accepts no arguments or target overrides.',
  );
  assertLocalProject();
  assert.equal(
    status().API_URL,
    'http://127.0.0.1:55321',
    'Refusing a non-QuickTrimr local stack.',
  );
  const sql = readFileSync(seedPath, 'utf8');
  assert.ok(
    sql === renderSeed(),
    'Committed seed drifted; regenerate before applying.',
  );
  query(sql); // Fixed named Docker container; no URL, password or .env input.
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    applySeed(process.argv.slice(2));
    console.log(
      'QuickTrimr local seed: PASS (insert-only transaction; existing rows preserved).',
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Local seed failed.',
    );
    process.exitCode = 1;
  }
}
