import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const requiredDirectories = [
  'apps/mobile/app',
  'apps/mobile/src/features',
  'apps/mobile/src/components',
  'apps/mobile/src/hooks',
  'apps/mobile/src/lib',
  'apps/mobile/src/stores',
  'apps/mobile/src/theme',
  'apps/admin/app',
  'apps/admin/src/features',
  'apps/admin/src/components',
  'apps/admin/src/lib',
  'apps/admin/src/hooks',
  'packages/shared',
  'packages/domain',
  'packages/validation',
  'packages/ui',
  'supabase/functions/_shared/auth',
  'supabase/functions/_shared/errors',
  'supabase/functions/_shared/logging',
  'supabase/functions/_shared/responses',
  'supabase/functions/_shared/validation',
  'supabase/functions/_shared/services',
  'supabase/migrations',
  'supabase/seed',
  'scripts/jira',
  'scripts/db',
  'scripts/stripe',
  'docs/architecture',
  'docs/decisions',
  'docs/api',
  'docs/qa',
];

const workspaceManifests = [
  'apps/mobile/package.json',
  'apps/admin/package.json',
  'packages/shared/package.json',
  'packages/domain/package.json',
  'packages/validation/package.json',
  'packages/ui/package.json',
  'supabase/functions/workspace-contract/package.json',
];

const sharedPackages = [
  '@quicktrimr/shared',
  '@quicktrimr/domain',
  '@quicktrimr/validation',
  '@quicktrimr/ui',
];

async function json(path) {
  return JSON.parse(await readFile(resolve(root, path), 'utf8'));
}

async function filesBelow(path) {
  const found = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.pnpm-store') continue;
    const absolute = join(path, entry.name);
    if (entry.isDirectory()) found.push(...await filesBelow(absolute));
    else found.push(absolute);
  }
  return found;
}

test('repository contains the KB section 7 directory structure', async () => {
  for (const directory of requiredDirectories) {
    assert.equal((await stat(resolve(root, directory))).isDirectory(), true, directory);
  }
});

test('root exposes the five recursive workspace commands', async () => {
  const manifest = await json('package.json');
  for (const command of ['typecheck', 'lint', 'format', 'test', 'build']) {
    assert.match(manifest.scripts[command], /pnpm --recursive --if-present/);
  }
});

test('workspace dependency graph follows ADR-007 and has no cycles', async () => {
  const manifests = await Promise.all(workspaceManifests.map(json));
  const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
  assert.equal(byName.size, workspaceManifests.length, 'workspace names must be unique');

  assert.deepEqual(byName.get('@quicktrimr/shared').dependencies ?? {}, {});
  for (const name of ['@quicktrimr/domain', '@quicktrimr/validation', '@quicktrimr/ui']) {
    assert.deepEqual(Object.keys(byName.get(name).dependencies ?? {}), ['@quicktrimr/shared']);
  }
  for (const name of ['@quicktrimr/mobile', '@quicktrimr/admin']) {
    assert.deepEqual(Object.keys(byName.get(name).dependencies ?? {}).sort(), [...sharedPackages].sort());
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(name) {
    if (visiting.has(name)) throw new Error(`workspace dependency cycle at ${name}`);
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dependency of Object.keys(byName.get(name).dependencies ?? {})) {
      if (byName.has(dependency)) visit(dependency);
    }
    visiting.delete(name);
    visited.add(name);
  }
  for (const name of byName.keys()) visit(name);
});

test('mobile, admin and a Supabase function resolve the shared package import', async () => {
  const [shared, ...modules] = await Promise.all([
    import(pathToFileURL(resolve(root, 'packages/shared/src/index.ts'))),
    import(pathToFileURL(resolve(root, 'apps/mobile/src/workspace-contract.ts'))),
    import(pathToFileURL(resolve(root, 'apps/admin/src/workspace-contract.ts'))),
    import(pathToFileURL(resolve(root, 'supabase/functions/workspace-contract/index.ts'))),
  ]);
  assert.deepEqual(modules.map((module) => module.mobileWorkspaceIdentity ?? module.adminWorkspaceIdentity ?? module.functionWorkspaceIdentity), [
    { product: 'QuickTrimr', surface: 'mobile' },
    { product: 'QuickTrimr', surface: 'admin' },
    { product: 'QuickTrimr', surface: 'function' },
  ]);
  assert.deepEqual(
    modules.map((module) => module.mobileBookingStatuses ?? module.adminBookingStatuses ?? module.functionBookingStatuses),
    [shared.BOOKING_STATUS, shared.BOOKING_STATUS, shared.BOOKING_STATUS],
  );
});

test('packages never import an app and placeholder files are absent', async () => {
  const files = await filesBelow(root);
  assert.equal(files.some((path) => path.endsWith('.gitkeep')), false);
  const packageFiles = files.filter((path) => {
    const projectPath = relative(root, path);
    return projectPath.startsWith('packages/') && /(?:\.ts|\.tsx|\.js|\.mjs|\.cjs|package\.json)$/.test(projectPath);
  });
  for (const path of packageFiles) {
    const contents = await readFile(path, 'utf8');
    assert.doesNotMatch(contents, /(?:from|import\()\s*['"]@quicktrimr\/(?:mobile|admin)['"]/);
  }
});

test('README documents setup and every required developer command', async () => {
  const readme = await readFile(resolve(root, 'README.md'), 'utf8');
  for (const text of [
    'pnpm install',
    'pnpm typecheck',
    'pnpm lint',
    'pnpm test',
    'pnpm --filter @quicktrimr/mobile start',
    'pnpm --filter @quicktrimr/admin dev',
    'Run Supabase locally',
  ]) {
    assert.match(readme, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
