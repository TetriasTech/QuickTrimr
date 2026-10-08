import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './fixture-e2e',
  outputDir: './test-results/fixtures',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:3101', trace: 'retain-on-failure' },
  webServer: {
    command: 'node ../../scripts/qa/admin-fixture-server.mjs',
    url: 'http://127.0.0.1:3101',
    reuseExistingServer: false,
  },
});
