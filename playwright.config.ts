import { defineConfig, devices } from '@playwright/test';
import { testBotToken } from './tests/telegram-fixture';

process.loadEnvFile('.env');
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test')) throw new Error('A separate TEST_DATABASE_URL ending in _test is required');

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 12000 },
  retries: 0,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], channel: process.env.CI ? undefined : 'chrome', baseURL: 'http://127.0.0.1:3100', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: [{
    command: 'node --env-file=.env --import tsx scripts/prepare-e2e.ts && npm run dev -- --port 3100',
    url: 'http://127.0.0.1:3100/api/session',
    reuseExistingServer: false,
    timeout: 120000,
    env: { DATABASE_URL: testUrl, DEMO_AUTH_ENABLED: 'true', TELEGRAM_AUTH_ENABLED: 'true', TELEGRAM_BOT_TOKEN: testBotToken, GEOAPIFY_API_KEY: '', APP_ORIGIN: 'http://127.0.0.1:3100', QADAM_NEXT_DIST_DIR: '.next-test', NEXT_TELEMETRY_DISABLED: '1' },
  }, {
    command: 'npm run dev -- --port 3101',
    url: 'http://127.0.0.1:3101/api/session',
    reuseExistingServer: false,
    timeout: 120000,
    env: { DATABASE_URL: testUrl, DEMO_AUTH_ENABLED: 'false', TELEGRAM_AUTH_ENABLED: 'true', TELEGRAM_BOT_TOKEN: testBotToken, GEOAPIFY_API_KEY: '', APP_ORIGIN: 'http://127.0.0.1:3101', QADAM_NEXT_DIST_DIR: '.next-telegram-only', NEXT_TELEMETRY_DISABLED: '1' },
  }],
});
