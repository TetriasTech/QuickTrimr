import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { ESLint } from 'eslint';
import * as prettier from 'prettier';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const eslint = new ESLint({ cwd: root });
const fixture = (name) =>
  readFile(new URL(`./fixtures/${name}.fixture`, import.meta.url), 'utf8');
const workspacePaths = [
  'apps/mobile',
  'apps/admin',
  'packages/shared',
  'packages/domain',
  'packages/validation',
  'packages/ui',
  'supabase/functions/workspace-contract',
];

function config(workspace) {
  const path = resolve(root, workspace, 'tsconfig.json');
  const file = ts.readConfigFile(path, ts.sys.readFile);
  assert.equal(file.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(
    file.config,
    ts.sys,
    resolve(root, workspace),
  );
  assert.deepEqual(parsed.errors, []);
  return parsed;
}

const lintCases = [
  [
    'any.ts',
    'packages/shared/src/index.ts',
    '@typescript-eslint/no-explicit-any',
  ],
  [
    'floating.ts',
    'apps/mobile/src/workspace-contract.ts',
    '@typescript-eslint/no-floating-promises',
  ],
  [
    'floating.ts',
    'apps/admin/src/workspace-contract.ts',
    '@typescript-eslint/no-floating-promises',
  ],
  [
    'floating.ts',
    'supabase/functions/workspace-contract/index.ts',
    '@typescript-eslint/no-floating-promises',
  ],
  [
    'hooks.tsx',
    'apps/mobile/src/components/placeholder-screen.tsx',
    'react-hooks/exhaustive-deps',
  ],
  ['hooks.tsx', 'apps/admin/app/error.tsx', 'react-hooks/exhaustive-deps'],
  ['domain.ts', 'packages/domain/src/index.ts', 'no-restricted-imports'],
  [
    'cross-app.ts',
    'apps/mobile/src/workspace-contract.ts',
    'no-restricted-imports',
  ],
  ['import-order.ts', 'apps/mobile/src/workspace-contract.ts', 'import/order'],
];
for (const [name, filePath, rule] of lintCases) {
  test(`${name} fails with ${rule} as an error in ${filePath}`, async () => {
    const [result] = await eslint.lintText(await fixture(name), {
      filePath: resolve(root, filePath),
    });
    assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
    assert.ok(
      result.messages.some(
        (message) => message.ruleId === rule && message.severity === 2,
      ),
      JSON.stringify(result.messages),
    );
  });
}

test('workspace import boundaries reject static, dynamic, CommonJS and relative escapes', async () => {
  const cases = [
    ['packages/domain/src/index.ts', "export * from 'node:fs';"],
    ['packages/domain/src/index.ts', "export const client = import('axios');"],
    [
      'packages/domain/src/index.ts',
      "export const client = require('stripe');",
    ],
    [
      'packages/domain/src/index.ts',
      "import fs = require('node:fs'); export { fs };",
    ],
    [
      'packages/domain/src/index.ts',
      "export * from '../../validation/src/index.ts';",
    ],
    [
      'packages/domain/src/index.ts',
      "export * from '../../shared/test/enums.test.mjs';",
    ],
    [
      'packages/domain/src/index.ts',
      'export const client = import(process.env.MODULE);',
    ],
    [
      'apps/mobile/src/workspace-contract.ts',
      "export * from '../../admin/src/workspace-contract';",
    ],
    [
      'apps/admin/src/workspace-contract.ts',
      "export * from '../../mobile/src/workspace-contract';",
    ],
    [
      'apps/mobile/src/workspace-contract.ts',
      "export const client = import('@quicktrimr/admin');",
    ],
    [
      'apps/mobile/src/workspace-contract.ts',
      "export * from '@/../../admin/src/workspace-contract';",
    ],
    [
      'packages/validation/src/index.ts',
      "export * from '../../../apps/admin/src/workspace-contract';",
    ],
    [
      'supabase/functions/workspace-contract/index.ts',
      "export * from '../../../apps/mobile/src/workspace-contract';",
    ],
  ];
  for (const [path, code] of cases) {
    const [result] = await eslint.lintText(code, {
      filePath: resolve(root, path),
    });
    assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
    assert.ok(
      result.messages.some(
        (message) =>
          message.ruleId === 'quicktrimr/imports' && message.severity === 2,
      ),
      `${path}: ${code}\n${JSON.stringify(result.messages)}`,
    );
  }
});

test('allowed shared imports and handled promises still pass', async () => {
  const cases = [
    [
      'packages/domain/src/index.ts',
      "export { BOOKING_STATUS } from '@quicktrimr/shared';\n",
    ],
    [
      'packages/domain/src/index.ts',
      "export { BOOKING_STATUS } from '../../shared/src/index.ts';\n",
    ],
    [
      'packages/shared/src/index.ts',
      "export { BOOKING_STATUS } from './enums/booking-status.ts';\n",
    ],
    [
      'apps/mobile/src/workspace-contract.ts',
      'export async function handled() { await Promise.resolve(); }\n',
    ],
    [
      'packages/ui/src/components/button.tsx',
      "import { useEffect } from 'react';\n\nexport function Fixture({ value }: { value: string }) { useEffect(() => { console.log(value); }, [value]); return null; }\n",
    ],
  ];
  for (const [path, code] of cases) {
    const [result] = await eslint.lintText(code, {
      filePath: resolve(root, path),
    });
    assert.deepEqual(
      result.messages,
      [],
      `${path}: ${JSON.stringify(result.messages)}`,
    );
  }
});

test('ESLint CLI exits nonzero for a typed negative fixture', async () => {
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/eslint/bin/eslint.js',
      '--stdin',
      '--stdin-filename',
      'packages/shared/src/index.ts',
      '--format',
      'json',
    ],
    { cwd: root, input: await fixture('any.ts'), encoding: 'utf8' },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.ok(
    JSON.parse(result.stdout)[0].messages.some(
      (message) => message.ruleId === '@typescript-eslint/no-explicit-any',
    ),
  );
});

test('typed promise enforcement rejects void suppression but accepts handled rejection', async () => {
  const filePath = resolve(root, 'apps/mobile/src/workspace-contract.ts');
  const [bad] = await eslint.lintText('void Promise.resolve();', { filePath });
  assert.ok(
    bad.messages.some(
      (message) =>
        message.ruleId === '@typescript-eslint/no-floating-promises' &&
        message.severity === 2,
    ),
  );
  const [good] = await eslint.lintText(
    'Promise.resolve().catch((error: unknown) => { console.error(error); });',
    { filePath },
  );
  assert.deepEqual(good.messages, []);
});

test('root and workspace invocations agree on admin import ordering', async () => {
  const workspaceLint = new ESLint({ cwd: resolve(root, 'apps/admin') });
  const files = [
    'apps/admin/test/auth.test.tsx',
    'apps/admin/src/components/ui/button.tsx',
  ].map((path) => resolve(root, path));
  for (const engine of [eslint, workspaceLint]) {
    for (const result of await engine.lintFiles(files))
      assert.deepEqual(result.messages, [], JSON.stringify(result.messages));
  }
});

test('every workspace inherits the strict base and is included in root checks', async () => {
  for (const workspace of workspacePaths) {
    const { options, fileNames } = config(workspace);
    for (const flag of [
      'strict',
      'noUncheckedIndexedAccess',
      'noImplicitOverride',
      'exactOptionalPropertyTypes',
    ])
      assert.equal(options[flag], true, `${workspace}: ${flag}`);
    assert.ok(
      fileNames.some((name) => name.endsWith('.ts') || name.endsWith('.tsx')),
    );
    const manifest = JSON.parse(
      await readFile(resolve(root, workspace, 'package.json'), 'utf8'),
    );
    assert.match(manifest.scripts.typecheck, /tsc --noEmit/);
    assert.match(manifest.scripts.lint, /eslint \. --max-warnings 0/);
  }
});

test('strictness flags actually reject unchecked, implicit, optional and override errors', async () => {
  const source = await fixture('strict.ts');
  const { options } = config('packages/shared');
  const path = resolve(root, 'scripts/quality/strict-fixture.ts');
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError) =>
    name === path
      ? ts.createSourceFile(name, source, languageVersion, true)
      : original(name, languageVersion, onError);
  const program = ts.createProgram([path], options, host);
  const codes = ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => diagnostic.code);
  for (const code of [7006, 2322, 2375, 4114])
    assert.ok(codes.includes(code), `${code} missing from ${codes}`);
});

test('shared package aliases resolve through real workspace exports in all three surfaces', () => {
  for (const workspace of [
    'apps/mobile',
    'apps/admin',
    'supabase/functions/workspace-contract',
  ]) {
    const { options } = config(workspace);
    const containing = resolve(
      root,
      workspace,
      workspace.startsWith('supabase')
        ? 'index.ts'
        : 'src/workspace-contract.ts',
    );
    const result = ts.resolveModuleName(
      '@quicktrimr/shared',
      containing,
      options,
      ts.sys,
    );
    assert.equal(
      result.resolvedModule?.resolvedFileName,
      resolve(root, 'packages/shared/src/index.ts'),
    );
  }
});

test('formatter checks fail bad input and pass the formatted result without rewriting it', async () => {
  const source = await fixture('unformatted.ts');
  const options = {
    ...(await prettier.resolveConfig(resolve(root, 'package.json'))),
    parser: 'typescript',
  };
  assert.equal(await prettier.check(source, options), false);
  assert.equal(
    await prettier.check(await prettier.format(source, options), options),
    true,
  );
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/prettier/bin/prettier.cjs',
      '--check',
      '--stdin-filepath',
      'quality-fixture.ts',
    ],
    { cwd: root, input: source, encoding: 'utf8' },
  );
  assert.equal(result.status, 1, result.stderr);
});

test('generated output and intentional negative fixtures are ignored by lint and format', async () => {
  for (const path of [
    'apps/mobile/dist/output.ts',
    'apps/mobile/.expo/types/router.d.ts',
    'apps/admin/.next/types/routes.d.ts',
    'apps/admin/next-env.d.ts',
    'apps/admin/coverage/output.js',
    'apps/admin/playwright-report/output.js',
    'packages/ui/build/output.ts',
    'packages/ui/node_modules/output.ts',
    'scripts/quality/fixtures/any.ts.fixture',
  ]) {
    assert.equal(await eslint.isPathIgnored(resolve(root, path)), true, path);
    assert.equal(
      (
        await prettier.getFileInfo(resolve(root, path), {
          ignorePath: resolve(root, '.prettierignore'),
        })
      ).ignored,
      true,
      path,
    );
  }
});

test('admin-local formatting uses the root ignores rather than scanning generated output', async () => {
  const manifest = JSON.parse(
    await readFile(resolve(root, 'apps/admin/package.json'), 'utf8'),
  );
  for (const command of ['format', 'format:check'])
    assert.match(
      manifest.scripts[command],
      /--ignore-path \.\.\/\.\.\/\.prettierignore/,
    );
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, 'node_modules/prettier/bin/prettier.cjs'),
      '--ignore-path',
      '../../.prettierignore',
      '--file-info',
      '.next/types/routes.d.ts',
    ],
    { cwd: resolve(root, 'apps/admin'), encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ignored, true);
});
