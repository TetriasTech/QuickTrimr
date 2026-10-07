import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  SHARED_ENUMS,
  assertPostgresEnumValuesMatch,
} from '../../packages/shared/src/index.ts';

import { migrationEnumValues, postgresEnumNames } from './core-schema.mjs';

const sql = await readFile(
  new URL(
    '../../supabase/migrations/20261007100000_core_schema.sql',
    import.meta.url,
  ),
  'utf8',
);
const enums = migrationEnumValues(sql);

test('the core migration declares exactly the shared PostgreSQL enum set', () => {
  assert.deepEqual(
    Object.keys(enums).sort(),
    Object.values(postgresEnumNames).sort(),
  );
});

for (const id of Object.keys(SHARED_ENUMS)) {
  test(`${id}: committed migration matches the shared tuple, including order`, () => {
    assertPostgresEnumValuesMatch(id, enums[postgresEnumNames[id]]);
  });
}
