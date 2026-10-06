import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '../..');
const read = (file) => readFile(resolve(root, file), 'utf8');
const workflowText = await read('.github/workflows/ci.yml');
const setupText = await read('.github/actions/setup-workspace/action.yml');
const docsText = await read('.github/workflows/docs.yml');
const workflow = parse(workflowText);
const setup = parse(setupText);
const docs = parse(docsText);
const { quality, 'client-env': clientEnv, required } = workflow.jobs;

test('CI triggers on all PR changes to main and all pushes to main without path filters', () => {
  assert.deepEqual(workflow.on, {
    pull_request: { branches: ['main'] },
    push: { branches: ['main'] },
  });
  assert.equal(workflow.concurrency['cancel-in-progress'], true);
  assert.match(workflow.concurrency.group, /github\.ref/);
});

test('four quality checks run independently and env guard has no dependency install', () => {
  assert.deepEqual(quality.strategy.matrix.check, [
    'typecheck',
    'lint',
    'format:check',
    'test',
  ]);
  assert.equal(quality.strategy['fail-fast'], false);
  assert.equal(quality.needs, undefined);
  assert.equal(clientEnv.needs, undefined);
  assert.ok(
    quality.steps.some(
      (step) => step.uses === './.github/actions/setup-workspace',
    ),
  );
  assert.deepEqual(quality.steps.at(-1).env, { CHECK: '${{ matrix.check }}' });
  assert.equal(quality.steps.at(-1).run, 'pnpm run "$CHECK"');
  assert.match(
    clientEnv.steps.at(-1).run,
    /node scripts\/check-client-env\.mjs/,
  );
  assert.match(
    clientEnv.steps.at(-1).run,
    /node --test scripts\/environment\/client-env\.test\.mjs/,
  );
  assert.match(
    clientEnv.steps.at(-1).run,
    /node scripts\/jira\/generate-indexes\.mjs --check/,
  );
  assert.ok(!clientEnv.steps.some((step) => step.uses?.startsWith('./')));
});

test('reusable setup derives pnpm version from packageManager, caches the lockfile and installs frozen', () => {
  assert.equal(setup.runs.using, 'composite');
  const [runtime, install, types] = setup.runs.steps;
  assert.match(runtime.uses, /^pnpm\/setup@[a-f0-9]{40}$/);
  assert.deepEqual(runtime.with, {
    runtime: 'node@24',
    cache: true,
    'cache-dependency-path': 'pnpm-lock.yaml',
    install: false,
  });
  assert.equal(install.run, 'pnpm install --frozen-lockfile');
  assert.equal(install.shell, 'bash');
  assert.equal(types.run, 'pnpm --filter @quicktrimr/admin exec next typegen');
  assert.equal(types.shell, 'bash');
});

test('workflow stays read-only, secret-free and immutable-action pinned', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.doesNotMatch(
    JSON.stringify([workflow, setup]),
    /secrets\.|pull_request_target|continue-on-error|workflow_run|\.env\.local|test:e2e|eas build|eas deploy/,
  );
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job.permissions, undefined);
    assert.equal(job['runs-on'], 'ubuntu-latest');
    assert.ok(job['timeout-minutes'] > 0);
    for (const step of job.steps) {
      if (step.uses && !step.uses.startsWith('./'))
        assert.match(step.uses, /@[a-f0-9]{40}$/);
      if (step.uses?.startsWith('actions/checkout@'))
        assert.equal(step.with['persist-credentials'], false);
    }
  }
});

test('stable merge gate always waits for every check and fails on failure, skipped or cancelled results', () => {
  assert.equal(required.name, 'CI required');
  assert.equal(required.if, '${{ always() }}');
  assert.deepEqual(required.needs, ['quality', 'client-env']);
  assert.deepEqual(required.steps[0].env, {
    QUALITY_RESULT: '${{ needs.quality.result }}',
    CLIENT_ENV_RESULT: '${{ needs.client-env.result }}',
  });
  for (const qualityResult of [
    'success',
    'failure',
    'cancelled',
    'skipped',
    '',
  ]) {
    for (const envResult of [
      'success',
      'failure',
      'cancelled',
      'skipped',
      '',
    ]) {
      const result = spawnSync(
        'bash',
        [
          '--noprofile',
          '--norc',
          '-eo',
          'pipefail',
          '-c',
          required.steps[0].run,
        ],
        {
          env: {
            PATH: process.env.PATH,
            QUALITY_RESULT: qualityResult,
            CLIENT_ENV_RESULT: envResult,
          },
          encoding: 'utf8',
        },
      );
      assert.equal(
        result.status === 0,
        qualityResult === 'success' && envResult === 'success',
        `${qualityResult}/${envResult}: ${result.stderr}`,
      );
    }
  }
});

test('public mobile types are explicit and do not depend on an Expo-generated file', async () => {
  const mobile = JSON.parse(await read('apps/mobile/tsconfig.json'));
  assert.ok(mobile.compilerOptions.types.includes('expo/types'));
});

test('README documents checks, stable gate and one-review policy', async () => {
  const readme = await read('README.md');
  for (const text of [
    'CI required',
    'one approving review',
    'pnpm typecheck',
    'pnpm lint',
    'pnpm format:check',
    'pnpm test',
    'check-client-env.mjs',
  ])
    assert.ok(readme.includes(text), text);
});

test('docs generation only runs after successful main validation and serializes branch updates', () => {
  const { regenerate } = docs.jobs;
  assert.equal(regenerate.needs, 'validate');
  assert.equal(
    regenerate.if,
    "github.event_name == 'push' && github.ref == 'refs/heads/main'",
  );
  assert.deepEqual(regenerate.concurrency, {
    group: 'docs-generated-indexes',
    'cancel-in-progress': false,
  });
  assert.deepEqual(regenerate.steps[0].with, {
    ref: 'main',
    'persist-credentials': false,
  });
  assert.deepEqual(
    regenerate.steps.filter((step) => step.run).map((step) => step.run),
    [
      'node scripts/jira/generate-indexes.mjs --check',
      'node scripts/jira/generate-indexes.mjs',
    ],
  );
});

test('docs PR reuses a scoped bot branch with minimum write permissions and no bypass', () => {
  assert.deepEqual(docs.permissions, { contents: 'read' });
  assert.equal(docs.jobs.validate.permissions, undefined);
  assert.deepEqual(docs.jobs.regenerate.permissions, {
    contents: 'write',
    'pull-requests': 'write',
  });
  const pr = docs.jobs.regenerate.steps.at(-1);
  assert.match(pr.uses, /^peter-evans\/create-pull-request@[a-f0-9]{40}$/);
  assert.equal(pr.with['add-paths'], 'QUICKTRIMR_BACKLOG_README.md');
  assert.equal(pr.with.branch, 'codex/generated-indexes');
  assert.equal(pr.with.base, 'main');
  assert.equal(pr.with.token, undefined);
  assert.equal(pr.with['branch-token'], undefined);
  assert.equal(pr.with['delete-branch'], undefined);
  assert.equal(pr.with['branch-suffix'], undefined);
  assert.match(pr.with.body, /Approve workflows to run/);
  assert.doesNotMatch(
    docsText,
    /git push|gh pr (merge|review)|\[skip ci\]|secrets\.|pull_request_target/,
  );
  for (const job of Object.values(docs.jobs)) {
    assert.ok(job['timeout-minutes'] > 0);
    for (const step of job.steps) {
      if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
      if (step.uses?.startsWith('actions/checkout@'))
        assert.equal(step.with['persist-credentials'], false);
    }
  }
});
