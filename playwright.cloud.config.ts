import { defineConfig, devices } from '@playwright/test';
import { assertCloudConfig } from './scripts/cloud-config';

assertCloudConfig();
process.env.E2E_ORIGIN = 'http://127.0.0.1:3200';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 25000 },
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results-cloud',
  use: { ...devices['Desktop Chrome'], channel: 'chrome', baseURL: process.env.E2E_ORIGIN, viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: {
    // Cloud schema/accounts are prepared explicitly through the management connection.
    // These browser tests create labelled E2E orders; they never delete cloud data.
    command: 'npm run dev:cloud -- --port 3200',
    url: `${process.env.E2E_ORIGIN}/api/session`,
    reuseExistingServer: false,
    timeout: 120000,
    env: { DATABASE_URL: process.env.DATABASE_URL!, DEMO_AUTH_ENABLED: 'true', APP_ORIGIN: process.env.E2E_ORIGIN, QADAM_NEXT_DIST_DIR: '.next-cloud-test', NEXT_TELEMETRY_DISABLED: '1' },
  },
});
