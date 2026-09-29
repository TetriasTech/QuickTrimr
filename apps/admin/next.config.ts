import { resolve } from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: [
    '@quicktrimr/shared',
    '@quicktrimr/domain',
    '@quicktrimr/validation',
    '@quicktrimr/ui',
  ],
  turbopack: { root: resolve(import.meta.dirname, '../..') },
  outputFileTracingRoot: resolve(import.meta.dirname, '../..'),
};

export default nextConfig;
