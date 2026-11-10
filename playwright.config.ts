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
    // Test the release build; development hot reload can restart authenticated flows.
    command: 'node --env-file=.env --import tsx scripts/prepare-e2e.ts && npm run start -- --port 3100',
    url: 'http://127.0.0.1:3100/api/session',
    reuseExistingServer: false,
    timeout: 120000,
    env: { DATABASE_URL: testUrl,TELEGRAM_LIVE_LOCATION_ENABLED:'true',TELEGRAM_LIVE_LOCATION_PILOT_ONLY:'true',TELEGRAM_WEBHOOK_SECRET:'synthetic_location_webhook_secret_abcdefghijklmnopqrstuvwxyz', DELIVERY_HANDOFFS_ENABLED:'false',DELIVERY_PROOF_ENABLED:'false',TELEGRAM_WORKER_ENABLED: 'false', DEMO_AUTH_ENABLED: 'true', TELEGRAM_AUTH_ENABLED: 'true', TELEGRAM_BOT_TOKEN: testBotToken, GEOAPIFY_API_KEY: '', TOMTOM_API_KEY:'',APP_ORIGIN: 'http://127.0.0.1:3100', QADAM_NEXT_DIST_DIR: '.next', NEXT_TELEMETRY_DISABLED: '1' },
  }, {
    command: 'npm run start -- --port 3101',
    url: 'http://127.0.0.1:3101/api/session',
    reuseExistingServer: false,
    timeout: 120000,
    env: { DATABASE_URL: testUrl, DELIVERY_HANDOFFS_ENABLED:'false',DELIVERY_PROOF_ENABLED:'false',TELEGRAM_WORKER_ENABLED: 'false', DEMO_AUTH_ENABLED: 'false', TELEGRAM_AUTH_ENABLED: 'true', TELEGRAM_BOT_TOKEN: testBotToken, GEOAPIFY_API_KEY: '', TOMTOM_API_KEY:'',APP_ORIGIN: 'http://127.0.0.1:3101', QADAM_NEXT_DIST_DIR: '.next', NEXT_TELEMETRY_DISABLED: '1' },
  }, {
    command:'npm run start -- --port 3104',url:'http://127.0.0.1:3104/api/session',reuseExistingServer:false,timeout:120000,
    env:{DATABASE_URL:testUrl,APP_ORIGIN:'http://127.0.0.1:3104',DEMO_AUTH_ENABLED:'false',TELEGRAM_AUTH_ENABLED:'true',TELEGRAM_BOT_TOKEN:testBotToken,TELEGRAM_WORKER_ENABLED:'false',GEOAPIFY_API_KEY:'',TOMTOM_API_KEY:'',DELIVERY_HANDOFFS_ENABLED:'false',DELIVERY_PROOF_ENABLED:'true',DELIVERY_CODE_SECRET:'ab'.repeat(32),TELEGRAM_STORAGE_CHAT_ID:'-1001234567890',QADAM_PHOTO_TEST_PROVIDER:'true',NODE_OPTIONS:'--import=./tests/e2e/photo-provider-preload.mjs',QADAM_NEXT_DIST_DIR:'.next',NEXT_TELEMETRY_DISABLED:'1'},
  }, {
    command:'npm run start -- --port 3105',url:'http://127.0.0.1:3105/api/session',reuseExistingServer:false,timeout:120000,
    env:{DATABASE_URL:testUrl,APP_ORIGIN:'http://127.0.0.1:3105',DELIVERY_HANDOFFS_ENABLED:'true',DELIVERY_PROOF_ENABLED:'true',DELIVERY_CODE_SECRET:'cd'.repeat(32),TELEGRAM_STORAGE_CHAT_ID:'-1001234567890',QADAM_PHOTO_TEST_PROVIDER:'true',NODE_OPTIONS:'--import=./tests/e2e/photo-provider-preload.mjs',DEMO_AUTH_ENABLED:'false',TELEGRAM_AUTH_ENABLED:'true',TELEGRAM_BOT_TOKEN:testBotToken,TELEGRAM_WORKER_ENABLED:'false',GEOAPIFY_API_KEY:'',TOMTOM_API_KEY:'',QADAM_NEXT_DIST_DIR:'.next',NEXT_TELEMETRY_DISABLED:'1'},
  }],
});
