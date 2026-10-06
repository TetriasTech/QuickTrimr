import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import importPlugin from 'eslint-plugin-import';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { boundaryPlugin } from './scripts/quality/boundaries.mjs';

const source = ['**/*.{js,jsx,mjs,cjs,ts,tsx}'];
const typescript = ['**/*.{ts,tsx}'];
const appImports = {
  regex:
    '^(?:@quicktrimr/(?:mobile|admin)(?:/|$)|(?:.*\\/)?apps/|(?:\\.\\./)+(?:mobile|admin)(?:/|$))',
  message: 'ADR-007: apps cannot be imported by another workspace.',
};

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/.next/**',
    '**/.expo/**',
    '**/.vercel/**',
    '**/dist/**',
    '**/build/**',
    '**/out/**',
    '**/coverage/**',
    '**/android/**',
    '**/ios/**',
    '**/playwright-report/**',
    '**/test-results/**',
    '**/next-env.d.ts',
    '**/expo-env.d.ts',
    'scripts/quality/fixtures/**',
  ]),
  {
    files: source,
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    settings: { 'import/internal-regex': '^@/' },
    plugins: {
      import: importPlugin,
      quicktrimr: boundaryPlugin(import.meta.dirname),
    },
    rules: {
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'type',
          ],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'no-restricted-imports': ['error', { patterns: [appImports] }],
      'quicktrimr/imports': 'error',
    },
  },
  {
    files: ['apps/admin/**/*.{js,mjs,ts,tsx}'],
    extends: [nextVitals],
    settings: { next: { rootDir: `${import.meta.dirname}/apps/admin/` } },
  },
  {
    files: typescript,
    extends: [tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': [
        'error',
        { ignoreVoid: false },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['**/*.{jsx,tsx}'],
    extends: [
      react.configs.flat.recommended,
      react.configs.flat['jsx-runtime'],
    ],
    plugins: { 'react-hooks': reactHooks },
    settings: { react: { version: '19.2.3' } },
    rules: { 'react/prop-types': 'off' },
  },
  {
    files: ['apps/**/*.{ts,tsx,js,jsx}', 'packages/ui/**/*.{ts,tsx,js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['packages/{domain,shared}/src/**/*.{ts,tsx,js,mjs,cjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!@quicktrimr/shared(?:/|$)|\\.{1,2}/).+',
              message:
                'ADR-007: pure packages cannot import I/O; domain depends only on shared.',
            },
            appImports,
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'fetch',
        'WebSocket',
        'XMLHttpRequest',
        'Deno',
        'Bun',
        'process',
      ],
    },
  },
  {
    files: ['packages/ui/test/setup.ts'],
    // Jest hoists mock factories: dependencies must be loaded inside the factory.
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
]);
