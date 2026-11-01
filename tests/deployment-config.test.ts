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

test('live location needs a protected Telegram webhook and keeps pilot settings server-only',()=>{
  const live={TELEGRAM_LIVE_LOCATION_ENABLED:'true',TELEGRAM_AUTH_ENABLED:'true',TELEGRAM_BOT_TOKEN:'123456789:local_test_only_abcdefghijklmnopqrstuvwxyz',TELEGRAM_WEBHOOK_SECRET:'synthetic-webhook-secret-abcdefghijklmnopqrstuvwxyz',TELEGRAM_LIVE_LOCATION_PILOT_IDS:'123456'};
  assert.doesNotThrow(()=>validateDeployment({...production,...live}));
  for(const missing of ['TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET','TELEGRAM_AUTH_ENABLED'])assert.throws(()=>validateDeployment({...production,...live,[missing]:undefined}));
  for(const bad of ['-1','user','1, 2','01'])assert.throws(()=>validateDeployment({...production,...live,TELEGRAM_LIVE_LOCATION_PILOT_IDS:bad}));
  assert.throws(()=>validateDeployment({QADAM_FRONTEND_ONLY:'true',NEXT_PUBLIC_API_ORIGIN:'https://api.example.test',TELEGRAM_LIVE_LOCATION_PILOT_IDS:'123456'}));
  assert.throws(()=>validateDeployment({VERCEL:'1',VERCEL_ENV:'preview',VERCEL_URL:'preview.vercel.app',...live}));
});

test('delivery proof validates its complete server configuration and stays out of frontend and Preview',()=>{
  const proof={DELIVERY_PROOF_ENABLED:'true',DELIVERY_CODE_SECRET:'ab'.repeat(32),TELEGRAM_STORAGE_CHAT_ID:'-1001234567890',TELEGRAM_BOT_TOKEN:'123456789:local_test_only_abcdefghijklmnopqrstuvwxyz'};
  assert.doesNotThrow(()=>validateDeployment({...production,...proof}));
  assert.doesNotThrow(()=>validateDeployment({...production,DELIVERY_PROOF_ENABLED:'false'}));
  for(const missing of ['DELIVERY_CODE_SECRET','TELEGRAM_STORAGE_CHAT_ID','TELEGRAM_BOT_TOKEN'])assert.throws(()=>validateDeployment({...production,...proof,[missing]:undefined}));
  for(const invalid of [{DELIVERY_CODE_SECRET:'short'},{TELEGRAM_STORAGE_CHAT_ID:'@public-channel'},{DELIVERY_PROOF_ENABLED:'1'}])assert.throws(()=>validateDeployment({...production,...invalid}));
  for(const privateSetting of [{DELIVERY_CODE_SECRET:proof.DELIVERY_CODE_SECRET},{TELEGRAM_STORAGE_CHAT_ID:proof.TELEGRAM_STORAGE_CHAT_ID},proof]){
    assert.throws(()=>validateDeployment({QADAM_FRONTEND_ONLY:'true',NEXT_PUBLIC_API_ORIGIN:'https://api.example.test',...privateSetting}));
    assert.throws(()=>validateDeployment({VERCEL:'1',VERCEL_ENV:'preview',VERCEL_URL:'test.vercel.app',...privateSetting}));
  }
});

test('routing candidate key stays server-only, including frontend builds and Preview',()=>{
  const key='synthetic-tomtom-key-12345678';
  assert.doesNotThrow(()=>validateDeployment({...production,TOMTOM_API_KEY:key}));
  assert.throws(()=>validateDeployment({...production,TOMTOM_API_KEY:'malformed key'}));
  assert.throws(()=>validateDeployment({QADAM_FRONTEND_ONLY:'true',NEXT_PUBLIC_API_ORIGIN:'https://api.example.test',TOMTOM_API_KEY:key}));
  assert.throws(()=>validateDeployment({VERCEL:'1',VERCEL_ENV:'preview',VERCEL_URL:'test.vercel.app',TOMTOM_API_KEY:key}));
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
