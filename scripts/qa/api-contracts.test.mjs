import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { build } from 'esbuild';
import ts from 'typescript';

import { CONTRACTS } from '../../packages/validation/src/contracts/index.ts';
import { renderContracts } from '../api/contracts.mjs';

const root = resolve(import.meta.dirname, '../..');

for (const app of ['mobile', 'admin'])
  test(`${app} fixture imports retain schema-inferred types under the actual app tsconfig`, () => {
    const appRoot = resolve(root, 'apps', app);
    const parsed = ts.getParsedCommandLineOfConfigFile(
      resolve(appRoot, 'tsconfig.json'),
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic(diagnostic) {
          throw new Error(
            ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
          );
        },
      },
    );
    assert.ok(parsed);
    const filename = resolve(appRoot, 'fixture-types-smoke.ts');
    const source = `import { API_FIXTURES as docs } from '../../docs/api/fixtures/index.mjs';
import { API_FIXTURES as pkg } from '@quicktrimr/validation/fixtures';
import type { ContractRequest } from '@quicktrimr/validation';
const a: ContractRequest<'create-booking-request'> = docs['create-booking-request'].request;
const b: ContractRequest<'create-booking-request'> = pkg['create-booking-request'].request;
// @ts-expect-error Fixture response must not be any or have arbitrary properties.
docs['search-available-now-barbers'].response.privatePhone;
// @ts-expect-error Request fixture must not allow server-owned commission.
pkg['create-booking-request'].request.commissionCents;
void a; void b;`;
    const options = { ...parsed.options, noEmit: true, incremental: false };
    const host = ts.createCompilerHost(options);
    const originalRead = host.readFile.bind(host);
    const originalExists = host.fileExists.bind(host);
    host.readFile = (path) => (path === filename ? source : originalRead(path));
    host.fileExists = (path) => path === filename || originalExists(path);
    const program = ts.createProgram([filename], options, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(
      diagnostics.length,
      0,
      diagnostics
        .map((diagnostic) =>
          ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        )
        .join('\n'),
    );
  });

test('API docs exactly match executable schemas, fixtures and error status/code metadata', async () => {
  const docs = await readFile(resolve(root, 'docs/api/contracts.md'), 'utf8');
  assert.equal(docs, renderContracts());
  const headings = [...docs.matchAll(/^### ([a-z-]+)$/gm)].map(
    (match) => match[1],
  );
  assert.equal(headings.length, 49);
  assert.equal(new Set(headings).size, 49);
  assert.deepEqual(headings.toSorted(), Object.keys(CONTRACTS).sort());
  assert.equal(
    (docs.match(/Shared request schema: `\w+Schema`/g) ?? []).length,
    49,
  );
  assert.equal(
    (docs.match(/Shared response schema: `\w+Schema`/g) ?? []).length,
    49,
  );
});

for (const app of ['mobile', 'admin'])
  test(`${app} can bundle and execute docs/package fixture imports without env, credentials, Node globals or network`, async () => {
    for (const entry of [
      '../../docs/api/fixtures/index.mjs',
      '@quicktrimr/validation/fixtures',
    ]) {
      const result = await build({
        absWorkingDir: resolve(root, 'apps', app),
        stdin: {
          contents: `import { API_FIXTURES } from ${JSON.stringify(entry)}; globalThis.fixtureCount = Object.keys(API_FIXTURES).length; globalThis.sample = API_FIXTURES['search-available-now-barbers'].response.results[0].priceCents;`,
          resolveDir: resolve(root, 'apps', app),
          sourcefile: 'fixture-import-smoke.ts',
          loader: 'ts',
        },
        bundle: true,
        write: false,
        metafile: true,
        platform: 'browser',
        format: 'iife',
        logLevel: 'silent',
      });
      const context = {
        URL,
        fetch() {
          throw new Error('Network forbidden in fixture import');
        },
      };
      runInNewContext(result.outputFiles[0].text, context, { timeout: 5000 });
      assert.equal(context.fixtureCount, 49);
      assert.equal(context.sample, 4500);
      assert.ok(
        !Object.keys(result.metafile.inputs).some((path) =>
          /(?:^|\/)\.env(?:\.|$)|stripe\/|supabase-js/.test(path),
        ),
      );
      for (const output of Object.values(result.metafile.outputs))
        assert.equal(output.imports.length, 0);
    }
  });

test('ordinary schema imports do not transitively include expanded fixtures or contract metadata', async () => {
  const result = await build({
    absWorkingDir: resolve(root, 'apps/mobile'),
    stdin: {
      contents:
        "import { CONTRACTS } from '@quicktrimr/validation'; console.log(Object.keys(CONTRACTS).length);",
      resolveDir: resolve(root, 'apps/mobile'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    metafile: true,
    platform: 'browser',
    logLevel: 'silent',
  });
  for (const input of Object.keys(result.metafile.inputs))
    assert.doesNotMatch(
      input,
      /all-examples|foundation-examples|\/fixtures\.ts|contract-details/,
    );
});

test('production app source has no fixture import or runtime mock fallback', async () => {
  const { readdir } = await import('node:fs/promises');
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name))
        assert.doesNotMatch(
          await readFile(path, 'utf8'),
          /validation\/fixtures|docs\/api\/fixtures|API_FIXTURES|foundation-examples/,
        );
    }
  }
  for (const app of ['mobile', 'admin'])
    for (const directory of ['app', 'src'])
      await scan(resolve(root, 'apps', app, directory));
});
