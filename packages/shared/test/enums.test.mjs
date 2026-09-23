import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  SHARED_ENUMS,
  assertPostgresEnumValuesMatch,
} from '../src/index.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const knowledgeBase = await readFile(
  resolve(packageRoot, '../../QUICKTRIMR_KNOWLEDGE_BASE.md'),
  'utf8',
);

function knowledgeBaseValues(id) {
  const heading = '### ' + id;
  const headingStart = knowledgeBase.indexOf(heading);
  assert.notEqual(headingStart, -1, id + ' must exist in the knowledge base');

  const blockStart = knowledgeBase.indexOf('```txt', headingStart);
  const blockEnd = knowledgeBase.indexOf('```', blockStart + 6);
  assert.notEqual(blockStart, -1, id + ' must have a txt code block');
  assert.notEqual(blockEnd, -1, id + ' txt code block must close');

  return knowledgeBase.slice(blockStart + 6, blockEnd).trim().split(/\s+/);
}

for (const [id, values] of Object.entries(SHARED_ENUMS)) {
  test(id + ' matches the knowledge base character for character', () => {
    assert.deepEqual(values, knowledgeBaseValues(id));
  });

  test(id + ' can assert exact Postgres enum parity', () => {
    assert.doesNotThrow(() => assertPostgresEnumValuesMatch(id, values));
    assert.throws(
      () => assertPostgresEnumValuesMatch(id, values.slice(1)),
      /Postgres values do not match packages\/shared/,
    );
  });
}
