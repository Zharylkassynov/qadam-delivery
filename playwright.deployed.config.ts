import { defineConfig, devices } from '@playwright/test';

const target = new URL(process.env.E2E_ORIGIN ?? '');
if (target.protocol !== 'https:' || target.pathname !== '/' || target.search || target.hash || target.username || target.password) {
  throw new Error('E2E_ORIGIN must be the exact public HTTPS origin');
}
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD is required for the deployed demo test accounts');
process.env.E2E_ORIGIN = target.origin;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 30000 },
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results-deployed',
  use: {
    ...devices['Desktop Chrome'], channel: process.env.CI ? undefined : 'chrome',
    baseURL: target.origin, viewport: { width: 1440, height: 1000 },
    // Public checks create labelled E2E orders; they never reset or delete database data.
    trace: 'retain-on-failure',
  },
});
