import { defineConfig, devices } from '@playwright/test';
import { testBotToken } from './tests/telegram-fixture';

process.loadEnvFile('.env');
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test')) throw new Error('A separate _test database is required');

export default defineConfig({
  testDir: './tests/api-e2e', workers: 1, fullyParallel: false, timeout: 60000,
  expect: { timeout: 12000 }, retries: 0, reporter: 'list',
  use: { ...devices['Desktop Chrome'], channel: process.env.CI ? undefined : 'chrome',
    baseURL: 'http://127.0.0.1:3103', viewport: { width: 390, height: 844 }, trace: 'retain-on-failure' },
  webServer: [{
    command: 'node scripts/apps.mjs backend test-start', url: 'http://127.0.0.1:3102/health',
    reuseExistingServer: false, timeout: 120000,
    env: { DATABASE_URL: testUrl, TEST_DATABASE_URL: testUrl, APP_ORIGIN: 'http://127.0.0.1:3103', API_ORIGIN: 'http://127.0.0.1:3102',
      PORT: '3102', DEMO_AUTH_ENABLED: 'true', TELEGRAM_AUTH_ENABLED: 'true', TELEGRAM_BOT_TOKEN: testBotToken,
      TELEGRAM_WEBHOOK_SECRET: 'synthetic_test_webhook_secret_abcdefghijklmnopqrstuvwxyz',
      TELEGRAM_WORKER_ENABLED: 'false', GEOAPIFY_API_KEY: '', QADAM_NEXT_DIST_DIR: '.next', NEXT_TELEMETRY_DISABLED: '1' },
  }, {
    command: 'node scripts/apps.mjs frontend start', url: 'http://127.0.0.1:3103/',
    reuseExistingServer: false, timeout: 120000,
    env: { PORT: '3103', NEXT_PUBLIC_API_ORIGIN: 'http://127.0.0.1:3102' },
  }],
});
