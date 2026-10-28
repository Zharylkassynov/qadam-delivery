import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appOrigin, validateDeployment } from '../src/lib/deployment-config';

const production = {
  VERCEL: '1', VERCEL_ENV: 'production', APP_ORIGIN: 'https://qadam-example.vercel.app',
  SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
  DATABASE_URL: 'postgresql://qadam_app.abcdefghijklmnopqrst:example@aws-1-eu-central-1.pooler.supabase.com:6543/postgres',
  DATABASE_SSL_CA_FILE: 'config/certs/supabase-root.crt', DEMO_AUTH_ENABLED: 'true',
};

test('production accepts the restricted transaction pooler and exact HTTPS origin', () => {
  assert.doesNotThrow(() => validateDeployment(production));
  assert.equal(appOrigin(production), production.APP_ORIGIN);
});

test('public deployments reject localhost, insecure URLs and non-origin URLs', () => {
  for (const APP_ORIGIN of ['http://qadam.example', 'http://localhost:3000', 'https://127.0.0.1', 'https://example.com/path', 'https://user:password@example.com', 'https://example.com?key=value', 'https://example.com#fragment']) {
    assert.throws(() => validateDeployment({ ...production, APP_ORIGIN }));
  }
  assert.throws(() => validateDeployment({ ...production, APP_ORIGIN: undefined, VERCEL_URL: 'other.vercel.app' }));
});

test('Vercel rejects owner credentials, session pooling and disabled database TLS', () => {
  for (const DATABASE_URL of [
    production.DATABASE_URL.replace('qadam_app.', 'postgres.'),
    production.DATABASE_URL.replace(':6543', ':5432'),
    production.DATABASE_URL.replace('aws-1-eu-central-1.pooler.supabase.com', 'localhost'),
    `${production.DATABASE_URL}?sslmode=disable`,
    `${production.DATABASE_URL}?ssl=no-verify`,
    'not-a-url',
  ]) assert.throws(() => validateDeployment({ ...production, DATABASE_URL }));
  assert.throws(() => validateDeployment({ ...production, NODE_TLS_REJECT_UNAUTHORIZED: '0' }));
  assert.throws(() => validateDeployment({ ...production, DATABASE_SSL_CA_FILE: undefined }));
  assert.throws(() => validateDeployment({ ...production, DATABASE_POOL_MAX: '1' }));
  assert.throws(() => validateDeployment({ ...production, QADAM_NEXT_DIST_DIR: '.next-cloud' }));
});

test('Preview uses its exact platform URL and cannot use the production database or demo login', () => {
  const preview = { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_URL: 'qadam-abc-user.vercel.app', DEMO_AUTH_ENABLED: 'false' };
  assert.doesNotThrow(() => validateDeployment(preview));
  assert.equal(appOrigin(preview), 'https://qadam-abc-user.vercel.app');
  assert.throws(() => validateDeployment({ ...preview, DATABASE_URL: production.DATABASE_URL }));
  assert.throws(() => validateDeployment({ ...preview, DEMO_AUTH_ENABLED: 'true' }));
  assert.throws(() => validateDeployment({ ...preview, GEOAPIFY_API_KEY: 'server-only-test-key' }));
  assert.throws(() => appOrigin({ ...preview, VERCEL_URL: 'qadam.vercel.app.evil.example' }));
});

test('local development keeps explicit origins and does not need Vercel settings', () => {
  assert.doesNotThrow(() => validateDeployment({}));
  assert.equal(appOrigin({ APP_ORIGIN: 'http://localhost:3000' }), 'http://localhost:3000');
  assert.equal(appOrigin({ APP_ORIGIN: 'http://127.0.0.1:3000/' }), 'http://127.0.0.1:3000');
});

test('Vercel rejects local Docker database mode before either Production or Preview can start', () => {
  assert.throws(() => validateDeployment({ ...production, QADAM_LOCAL_DOCKER: 'true' }));
  assert.throws(() => validateDeployment({ VERCEL: '1', VERCEL_ENV: 'preview', QADAM_LOCAL_DOCKER: 'true' }));
  assert.doesNotThrow(() => validateDeployment({ ...production, QADAM_LOCAL_DOCKER: 'false' }));
});

test('Telegram requires a server token when enabled and stays disabled on Preview', () => {
  assert.throws(() => validateDeployment({ ...production, TELEGRAM_AUTH_ENABLED: 'true' }));
  assert.throws(() => validateDeployment({ ...production, TELEGRAM_AUTH_ENABLED: 'yes' }));
  const telegram = { ...production, TELEGRAM_AUTH_ENABLED: 'true', TELEGRAM_BOT_TOKEN: '123456789:synthetic_ci_only_abcdefghijklmnopqrstuvwxyz', TELEGRAM_WEBHOOK_SECRET: 'local-test-secret-abcdefghijklmnopqrstuvwxyz' };
  assert.doesNotThrow(() => validateDeployment(telegram));
  assert.throws(() => validateDeployment({ ...telegram, TELEGRAM_WORKER_ENABLED: 'false' }));
  assert.throws(() => validateDeployment({ TELEGRAM_WORKER_ENABLED: 'invalid' }));
  assert.doesNotThrow(() => validateDeployment({ ...telegram, TELEGRAM_WORKER_ENABLED: 'true' }));
  for (const secret of [undefined, 'short', 'x'.repeat(257), 'invalid secret'.repeat(4)]) assert.throws(() => validateDeployment({ ...telegram, TELEGRAM_WEBHOOK_SECRET: secret }));
  assert.throws(() => validateDeployment({ VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_URL: 'qadam-test.vercel.app', TELEGRAM_WEBHOOK_SECRET: telegram.TELEGRAM_WEBHOOK_SECRET }));
  assert.throws(() => validateDeployment({ VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_URL: 'qadam-test.vercel.app', TELEGRAM_BOT_TOKEN: 'private' }));
});
