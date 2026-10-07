import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const templatePath = '.github/pull_request_template.md';
const guidePath = 'docs/qa/review-checklist.md';
const read = (path) => readFile(resolve(root, path), 'utf8');

test('GitHub discovery locations contain one default PR template with unchecked boxes', async () => {
  const templates = [];
  for (const directory of ['.', 'docs', '.github']) {
    for (const entry of await readdir(resolve(root, directory))) {
      if (/^pull_request_template\.md$/i.test(entry))
        templates.push(relative(root, resolve(root, directory, entry)));
      assert.notEqual(
        entry.toLowerCase(),
        'pull_request_template',
        'Multiple-template directories require explicit selection',
      );
    }
  }
  assert.deepEqual(templates, [templatePath]);
  const template = await read(templatePath);
  assert.ok(template.match(/^- \[ \] /gm)?.length);
  assert.doesNotMatch(template, /^- \[[xX]\] /m);
});

test('PR template links to the review guide and all repository document links resolve', async () => {
  const edges = [];
  for (const source of [templatePath, guidePath, 'docs/qa/README.md']) {
    const markdown = await read(source);
    for (const [, href] of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      let target;
      if (/^https?:/.test(href)) {
        const url = new URL(href);
        const prefix = '/TetriasTech/QuickTrimr/blob/main/';
        if (url.hostname !== 'github.com' || !url.pathname.startsWith(prefix))
          continue;
        target = resolve(
          root,
          decodeURIComponent(url.pathname.slice(prefix.length)),
        );
      } else {
        target = resolve(root, dirname(source), decodeURIComponent(href));
      }
      const path = relative(root, target);
      assert.ok(
        !path.startsWith('..'),
        `${source}: link escapes repo: ${href}`,
      );
      assert.ok((await stat(target)).isFile(), `${source}: missing ${href}`);
      edges.push({ source, target: path });
    }
  }
  assert.ok(
    edges.some(
      ({ source, target }) => source === templatePath && target === guidePath,
    ),
  );
  assert.ok(
    edges.some(
      ({ source, target }) => source === guidePath && target === templatePath,
    ),
  );
  assert.ok(
    edges.some(
      ({ source, target }) =>
        source === 'docs/qa/README.md' && target === guidePath,
    ),
  );
});

test('root test command includes the template discovery and link checks', async () => {
  const manifest = JSON.parse(await read('package.json'));
  assert.ok(manifest.scripts.test.includes('scripts/qa/*.test.mjs'));
});
