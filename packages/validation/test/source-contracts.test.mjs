import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { SHARED_ENUMS } from '@quicktrimr/shared';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contractsRoot = resolve(packageRoot, 'src/contracts');

test('all named contract payload types are inferred with z.infer', async () => {
  const files = (await readdir(contractsRoot)).filter((file) => file.endsWith('.ts') && file !== 'index.ts');
  const source = (await Promise.all(files.map((file) => readFile(resolve(contractsRoot, file), 'utf8')))).join('\n');

  assert.equal((source.match(/export type \w+(?:Request|Response) = z\.infer</g) ?? []).length, 30);
  assert.doesNotMatch(source, /export interface/);
  assert.doesNotMatch(source, /export type \w+(?:Request|Response)\s*=\s*\{/);
});

test('validation source does not redeclare shared status literals', async () => {
  const sourceFiles = [
    resolve(packageRoot, 'src/primitives.ts'),
    resolve(packageRoot, 'src/examples.ts'),
    ...((await readdir(contractsRoot)).map((file) => resolve(contractsRoot, file))),
  ];
  const source = (await Promise.all(sourceFiles.map((file) => readFile(file, 'utf8')))).join('\n');

  for (const value of new Set(Object.values(SHARED_ENUMS).flat())) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.doesNotMatch(source, new RegExp(`(["'])${escaped}\\1`), value);
  }
  assert.doesNotMatch(source, /z\.enum\(\s*\[/);
});
