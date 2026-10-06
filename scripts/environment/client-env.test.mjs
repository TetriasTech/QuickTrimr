import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

import { checkClientEnv, serverOnlyNames } from '../check-client-env.mjs';

const root = resolve(import.meta.dirname, '../..');

async function fixture(t, files) {
  const directory = await mkdtemp(resolve(tmpdir(), 'quicktrimr-env-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(resolve(directory, 'apps'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(directory, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  return directory;
}

test('real app tree passes without requiring any credentials', async () => {
  assert.deepEqual(await checkClientEnv(root), []);
});

test('planted service-role reference in apps/mobile fails the actual CLI without printing its value', async (t) => {
  const secret = 'SYNTHETIC-DO-NOT-PRINT';
  const directory = await fixture(t, {
    'apps/mobile/src/leak.ts': `export const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // ${secret}`,
    'scripts/placeholder': '',
  });
  const script = resolve(directory, 'scripts/check-client-env.mjs');
  await copyFile(resolve(root, 'scripts/check-client-env.mjs'), script);
  const result = spawnSync(process.execPath, [script], {
    cwd: tmpdir(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /apps\/mobile\/src\/leak.ts:1/);
  assert.match(result.stderr, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
});

test('all server-only names are rejected in both apps, including public-prefixed aliases', async (t) => {
  for (const app of ['mobile', 'admin']) {
    const directory = await fixture(t, {
      [`apps/${app}/reference.txt`]: serverOnlyNames
        .map((name) => `EXPO_PUBLIC_${name}=synthetic`)
        .join('\n'),
    });
    const findings = await checkClientEnv(directory);
    for (const name of serverOnlyNames)
      assert.ok(findings.some((finding) => finding.rule === name));
  }
});

test('hidden env files, docs, templates, native files and bracket/destructured references are scanned', async (t) => {
  const files = {
    'apps/admin/.env.local': 'STRIPE_SECRET_KEY=synthetic',
    'apps/mobile/.env.example': 'NEXT_PUBLIC_STRIPE_WEBHOOK_SECRET=',
    'apps/admin/README.md': 'Do not copy GOOGLE_MAPS_SERVER_API_KEY here.',
    'apps/mobile/android/key.xml': '<key>GOOGLE_SERVER_API_KEY</key>',
    'apps/mobile/src/brackets.ts':
      "const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];",
    'apps/mobile/src/destructure.ts':
      'const { STRIPE_SECRET_KEY } = process.env;',
  };
  const directory = await fixture(t, files);
  const findings = await checkClientEnv(directory);
  assert.deepEqual(
    findings.map(({ file }) => file).sort(),
    Object.keys(files).sort(),
  );
});

test('public variables pass; dependencies and generated outputs do not create false failures', async (t) => {
  const directory = await fixture(t, {
    'apps/mobile/src/env.ts': 'process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;',
    'apps/admin/.env.example': 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=',
    'apps/mobile/node_modules/vendor/readme': 'STRIPE_SECRET_KEY',
    'apps/admin/.next/cache/generated': 'SUPABASE_SERVICE_ROLE_KEY',
    'supabase/functions/server.ts': 'STRIPE_SECRET_KEY',
  });
  assert.deepEqual(await checkClientEnv(directory), []);
});

test('source symlinks are denied, not silently skipped or followed outside apps', async (t) => {
  const directory = await fixture(t, { 'server.ts': 'STRIPE_SECRET_KEY' });
  await symlink(
    resolve(directory, 'server.ts'),
    resolve(directory, 'apps/leak.ts'),
  );
  assert.deepEqual(await checkClientEnv(directory), [
    { file: 'apps/leak.ts', line: 1, rule: 'source symlink is not permitted' },
  ]);
});

test('missing apps and unexpected CLI flags fail closed', async (t) => {
  const directory = await fixture(t, {});
  await assert.rejects(checkClientEnv(resolve(directory, 'missing')));
  const result = spawnSync(
    process.execPath,
    [resolve(root, 'scripts/check-client-env.mjs'), '--skip'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /PASS/);
});
