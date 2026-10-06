import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const packageRoot = process.cwd();
const repositoryRoot = resolve(packageRoot, '../..');

async function sourceFilesBelow(path: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const absolute = resolve(path, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFilesBelow(absolute)));
    else if (/\.tsx?$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

test('the public package exports every ticket primitive', async () => {
  const source = await readFile(resolve(packageRoot, 'src/index.ts'), 'utf8');

  for (const component of [
    'Avatar',
    'Badge',
    'BottomSheet',
    'Button',
    'Card',
    'ConfirmDialog',
    'EmptyState',
    'ErrorState',
    'LoadingState',
    'Screen',
    'StatusBadge',
    'TextInput',
  ]) {
    assert.match(
      source,
      new RegExp(`export \\{ ${component}(?:,| \\})`),
      component,
    );
  }
});

test('shared UI source contains no explicit any', async () => {
  for (const file of await sourceFilesBelow(resolve(packageRoot, 'src'))) {
    assert.doesNotMatch(await readFile(file, 'utf8'), /\bany\b/, file);
  }
});

test('hex colors stay in the theme and never appear in components or features', async () => {
  const paths = [
    resolve(packageRoot, 'src/components'),
    resolve(repositoryRoot, 'apps/mobile/src/features'),
  ];

  for (const path of paths) {
    for (const file of await sourceFilesBelow(path)) {
      assert.doesNotMatch(
        await readFile(file, 'utf8'),
        /#[\da-f]{3,8}\b/i,
        file,
      );
    }
  }
});
