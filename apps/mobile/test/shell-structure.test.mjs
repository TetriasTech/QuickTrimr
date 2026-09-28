import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const requiredRoutes = [
  'app/_layout.tsx',
  'app/(auth)/_layout.tsx',
  'app/(auth)/index.tsx',
  'app/(client)/_layout.tsx',
  'app/(client)/index.tsx',
  'app/(barber)/_layout.tsx',
  'app/(barber)/index.tsx',
  'app/(modals)/_layout.tsx',
  'app/(modals)/shell-info.tsx',
  'app/onboarding.tsx',
];

test('every required Expo Router shell route exists and has a default export', async () => {
  for (const route of requiredRoutes) {
    const source = await readFile(resolve(mobileRoot, route), 'utf8');
    assert.match(source, /export default function/, route);
  }
});

test('the root navigator protects every journey with typed route access', async () => {
  const source = await readFile(resolve(mobileRoot, 'app/_layout.tsx'), 'utf8');

  for (const group of ['(auth)', '(client)', '(barber)', '(modals)']) {
    assert.equal(source.includes(`name="${group}"`), true, group);
  }
  assert.match(source, /name=["']onboarding["']/);
  assert.equal((source.match(/<Stack\.Protected /g) ?? []).length, 5);
});

test('the Metro resolution probe imports all four shared workspace packages', async () => {
  const source = await readFile(resolve(mobileRoot, 'src/workspace-contract.ts'), 'utf8');

  for (const packageName of [
    '@quicktrimr/shared',
    '@quicktrimr/domain',
    '@quicktrimr/validation',
    '@quicktrimr/ui',
  ]) {
    assert.match(source, new RegExp(`from ["']${packageName}["']`), packageName);
  }
});

test('the mobile shell does not add out-of-scope state or auth libraries', async () => {
  const manifest = JSON.parse(await readFile(resolve(mobileRoot, 'package.json'), 'utf8'));
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };

  for (const outOfScope of [
    '@supabase/supabase-js',
    '@tanstack/react-query',
    'zustand',
    'react-hook-form',
    'redux',
    '@reduxjs/toolkit',
    'expo-notifications',
  ]) {
    assert.equal(outOfScope in dependencies, false, outOfScope);
  }
});
