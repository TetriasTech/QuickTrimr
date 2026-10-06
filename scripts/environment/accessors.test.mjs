import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import ts from 'typescript';

import { adminEnv } from '../../apps/admin/src/lib/env.ts';
import { mobileEnv } from '../../apps/mobile/src/lib/env.ts';
import {
  requireEnvironmentUrl,
  requireEnvironmentValue,
} from '../../packages/validation/src/environment.ts';

const root = resolve(import.meta.dirname, '../..');
const apps = [
  {
    name: 'mobile',
    prefix: 'EXPO_PUBLIC_',
    accessor: mobileEnv,
    exportName: 'mobileEnv',
  },
  {
    name: 'admin',
    prefix: 'NEXT_PUBLIC_',
    accessor: adminEnv,
    exportName: 'adminEnv',
  },
];

test('validation rejects absent/blank inputs and invalid URLs without reflecting values', () => {
  for (const value of [undefined, '', '   ']) {
    assert.throws(() => requireEnvironmentValue(value, 'PUBLIC_NAME'), {
      message: 'Missing environment variable: PUBLIC_NAME',
    });
  }
  for (const value of [
    'not-a-url-private-sentinel',
    'javascript:private-sentinel',
  ]) {
    assert.throws(() => requireEnvironmentUrl(value, 'PUBLIC_URL'), {
      message: 'Invalid environment URL: PUBLIC_URL',
    });
  }
  assert.equal(
    requireEnvironmentValue('  synthetic  ', 'PUBLIC_NAME'),
    'synthetic',
  );
  assert.equal(
    requireEnvironmentUrl('http://127.0.0.1:54321', 'PUBLIC_URL'),
    'http://127.0.0.1:54321',
  );
});

for (const { name, prefix, accessor, exportName } of apps) {
  test(`${name} accessor is lazy, whitelisted, config-backed and matches its template`, async (t) => {
    const source = await readFile(
      resolve(root, `apps/${name}/src/lib/env.ts`),
      'utf8',
    );
    const template = await readFile(
      resolve(root, `apps/${name}/.env.example`),
      'utf8',
    );
    const names = [...source.matchAll(/process\.env\.([A-Z_]+)/g)].map(
      (match) => match[1],
    );
    const templateNames = [...template.matchAll(/^([A-Z_]+)=/gm)].map(
      (match) => match[1],
    );
    assert.deepEqual([...names].sort(), templateNames.sort());
    assert.equal(Object.keys(accessor).length, names.length);
    assert.ok(names.every((key) => key.startsWith(prefix)));
    const saved = new Map(names.map((key) => [key, process.env[key]]));
    t.after(() => {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    for (const key of names) delete process.env[key];
    assert.throws(() => accessor.supabaseUrl, /Missing environment variable/);
    // Unrelated unset integrations cannot break a configured getter.
    process.env[`${prefix}SUPABASE_URL`] = 'http://127.0.0.1:54321';
    assert.equal(accessor.supabaseUrl, 'http://127.0.0.1:54321');
    process.env[`${prefix}SUPABASE_URL`] = 'https://synthetic.example.invalid';
    assert.equal(accessor.supabaseUrl, 'https://synthetic.example.invalid');
    for (const key of names)
      process.env[key] = /(?:URL|DSN|HOST)$/.test(key)
        ? 'https://synthetic.example.invalid'
        : `synthetic-${key}`;
    for (const value of Object.values(accessor))
      assert.equal(typeof value, 'string');
    assert.equal('serviceRoleKey' in accessor, false);
    assert.equal('stripeSecretKey' in accessor, false);
    assert.equal('stripeWebhookSecret' in accessor, false);
    assert.equal('googleMapsServerApiKey' in accessor, false);
  });

  test(`${name} types reject all four secret categories and arbitrary string lookup`, () => {
    const configPath = resolve(root, `apps/${name}/tsconfig.json`);
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    assert.equal(config.error, undefined);
    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      resolve(root, `apps/${name}`),
      {},
      configPath,
    );
    const path = resolve(root, `apps/${name}/src/lib/env-contract.fixture.ts`);
    const forbidden = [
      'serviceRoleKey',
      'stripeSecretKey',
      'stripeWebhookSecret',
      'googleMapsServerApiKey',
    ];
    const source = `import { ${exportName} as env } from './env.ts';\nconst valid: string = env.supabaseUrl;\n${forbidden.map((key) => `env.${key};`).join('\n')}\ndeclare const arbitrary: string;\nenv[arbitrary];\nvoid valid;`;
    const host = ts.createCompilerHost(parsed.options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (file, version, onError) =>
      file === path
        ? ts.createSourceFile(file, source, version, true)
        : original(file, version, onError);
    const program = ts.createProgram(
      [...parsed.fileNames, path],
      parsed.options,
      host,
    );
    const diagnostics = ts.getPreEmitDiagnostics(program);
    // TypeScript uses 2551 instead of 2339 when it can suggest a nearby public property.
    assert.equal(
      diagnostics.filter(({ code }) => code === 2339 || code === 2551).length,
      4,
    );
    assert.equal(diagnostics.filter(({ code }) => code === 7053).length, 1);
    assert.equal(
      diagnostics.length,
      5,
      ts.formatDiagnostics(diagnostics, {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: () => root,
        getNewLine: () => '\n',
      }),
    );
  });
}

test('all committed env templates have a reader/meaning comment and no credential values', async () => {
  for (const file of [
    '.env.example',
    'apps/mobile/.env.example',
    'apps/admin/.env.example',
    'supabase/.env.example',
    'scripts/jira/.env.example',
  ]) {
    const text = await readFile(resolve(root, file), 'utf8');
    const lines = text.split('\n');
    for (const [index, line] of lines.entries()) {
      const match = /^(?:# )?([A-Z_]+)=(.*)$/.exec(line);
      if (!match) continue;
      assert.match(
        lines[index - 1],
        /^# .+/,
        `${file}: ${match[1]} needs a comment`,
      );
      if (
        /KEY|TOKEN|SECRET|PASSWORD|DSN/.test(match[1]) &&
        match[1] !== 'JIRA_PROJECT_KEY'
      )
        assert.equal(match[2], '', `${file}: ${match[1]} must be empty`);
    }
  }
});

test('existing operator and runtime inputs are covered without inventing a root app env', async () => {
  const example = await readFile(resolve(root, '.env.example'), 'utf8');
  for (const file of [
    'scripts/jira/create-tickets.mjs',
    'scripts/spikes/P0-D07/inngest/proof.mjs',
    'apps/admin/playwright.config.ts',
    'packages/ui/src/components/screen.tsx',
  ]) {
    const source = await readFile(resolve(root, file), 'utf8');
    for (const [, key] of source.matchAll(/process\.env\.([A-Z_]+)/g))
      assert.ok(example.includes(key), `${key} is undocumented`);
  }
});
