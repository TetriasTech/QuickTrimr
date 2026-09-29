import { readFile, readdir } from 'node:fs/promises';
import { expect, it } from 'vitest';
import nextConfig from '../next.config';
import vercel from '../vercel.json';
import components from '../components.json';

it('configures workspace transpilation and Vercel without linking or deploying', () => {
  expect(nextConfig.transpilePackages).toEqual([
    '@quicktrimr/shared',
    '@quicktrimr/domain',
    '@quicktrimr/validation',
    '@quicktrimr/ui',
  ]);
  expect(vercel.framework).toBe('nextjs');
  expect(vercel.installCommand).toBe(
    'cd ../.. && pnpm install --frozen-lockfile',
  );
  expect(vercel.buildCommand).toBe('pnpm build');
  expect(components.rsc).toBe(true);
  expect(components.tailwind.css).toBe('app/globals.css');
});

it('keeps server components as the default and documents every client boundary', async () => {
  const clientFiles: string[] = [];
  for (const dir of ['app', 'src']) {
    const files = await readdir(new URL(`../${dir}/`, import.meta.url), {
      recursive: true,
    });
    for (const file of files.filter((name) => /\.tsx?$/.test(name))) {
      const source = await readFile(
        new URL(`../${dir}/${file}`, import.meta.url),
        'utf8',
      );
      if (/^["']use client["'];/m.test(source)) {
        clientFiles.push(`${dir}/${file}`);
        expect(source).toMatch(/\/\/.*(?:interactivity|interactive)/);
      }
    }
  }
  expect(clientFiles).toEqual(['app/error.tsx']);
  for (const file of ['session.ts', 'require-admin.ts']) {
    const source = await readFile(
      new URL(`../src/lib/auth/${file}`, import.meta.url),
      'utf8',
    );
    expect(source).toMatch(/import 'server-only'/);
  }
});
