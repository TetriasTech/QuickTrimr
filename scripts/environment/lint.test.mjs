import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { ESLint } from 'eslint';

const root = resolve(import.meta.dirname, '../..');
const eslint = new ESLint({ cwd: root });

test('app code cannot bypass typed accessors with direct, dynamic, aliased or destructured environment access', async () => {
  for (const app of ['mobile', 'admin']) {
    for (const source of [
      'export const key = process.env.SUPABASE_SERVICE_ROLE_KEY;',
      "export const key = process.env['STRIPE_SECRET_KEY'];",
      "const name = 'STRIPE_' + 'SECRET_KEY'; export const key = process.env[name];",
      'export const { env } = process;',
      'export const values = { ...process.env };',
      'export const alias = process;',
      'export const key = process.env.EXPO_PUBLIC_SUPABASE_URL;',
      "export const key = process['env'].NEXT_PUBLIC_SUPABASE_URL;",
    ]) {
      const [result] = await eslint.lintText(source, {
        filePath: resolve(root, `apps/${app}/src/workspace-contract.ts`),
      });
      assert.equal(result.fatalErrorCount, 0);
      assert.ok(
        result.messages.some(
          ({ ruleId, severity }) =>
            ruleId === 'client-env/typed-accessor' && severity === 2,
        ),
      );
    }
  }
});

test('accessor files cannot read undeclared, other-tier or computed variables', async () => {
  for (const app of ['mobile', 'admin']) {
    for (const source of [
      'export const key = process.env.SUPABASE_SERVICE_ROLE_KEY;',
      'export const key = process.env.EXPO_PUBLIC_UNDOCUMENTED;',
      'export const key = process.env.NEXT_PUBLIC_UNDOCUMENTED;',
      "export const key = process.env['EXPO_PUBLIC_SUPABASE_URL'];",
    ]) {
      const [result] = await eslint.lintText(source, {
        filePath: resolve(root, `apps/${app}/src/lib/env.ts`),
      });
      assert.ok(
        result.messages.some(
          ({ ruleId }) => ruleId === 'client-env/typed-accessor',
        ),
      );
    }
  }
});

test('real public readers and the runner-provided Playwright CI flag pass lint', async () => {
  const results = await eslint.lintFiles(
    [
      'apps/mobile/src/lib/env.ts',
      'apps/admin/src/lib/env.ts',
      'apps/admin/playwright.config.ts',
    ].map((file) => resolve(root, file)),
  );
  for (const result of results)
    assert.deepEqual(result.messages, [], JSON.stringify(result.messages));
});
