import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { validateBackend } from '../backend/config';
import { proxy } from '../backend/proxy';
import { apiOrigin, apiPath } from '../src/lib/api-origin';
import { validateDeployment } from '../src/lib/deployment-config';

const local = {
  QADAM_BACKEND: 'true', APP_ORIGIN: 'http://127.0.0.1:3103', API_ORIGIN: 'http://127.0.0.1:3102',
  DATABASE_URL: 'postgresql://qadam:synthetic@127.0.0.1:55432/qadam_delivery_test',
  DEMO_AUTH_ENABLED: 'true', DEMO_PASSWORD: 'synthetic-local-password', TELEGRAM_AUTH_ENABLED: 'false',
};

test('standalone backend validates its server settings and keeps local-only modes off public origins', () => {
  assert.doesNotThrow(() => validateBackend(local));
  for (const change of [
    { VERCEL: '1' }, { DATABASE_URL: undefined }, { API_ORIGIN: undefined }, { QADAM_BACKEND: undefined },
    { NODE_TLS_REJECT_UNAUTHORIZED: '0' }, { DEMO_PASSWORD: 'short' }, { TELEGRAM_AUTH_ENABLED: 'yes' },
    { APP_ORIGIN: 'https://qadam.example', API_ORIGIN: 'https://api.qadam.example' },
    { APP_ORIGIN: 'https://qadam.example', DEMO_AUTH_ENABLED: 'false' },
  ]) assert.throws(() => validateBackend({ ...local, ...change }));
  const publicBackend = { ...local, APP_ORIGIN: 'https://qadam.example', API_ORIGIN: 'https://api.qadam.example',
    DEMO_AUTH_ENABLED: 'false', TELEGRAM_AUTH_ENABLED: 'true', TELEGRAM_BOT_TOKEN: '123456789:synthetic_test_only_abcdefghijklmnopqrstuvwxyz',
    TELEGRAM_WEBHOOK_SECRET: 'synthetic_test_webhook_secret_abcdefghijklmnopqrstuvwxyz' };
  assert.doesNotThrow(() => validateBackend(publicBackend));
  assert.throws(() => validateBackend({ ...publicBackend, TELEGRAM_WORKER_ENABLED: 'false' }));
  assert.throws(() => validateBackend({ ...publicBackend, TELEGRAM_BOT_TOKEN: undefined }));
  assert.throws(() => validateDeployment({ VERCEL: '1', QADAM_BACKEND: 'true' }));
});

test('API origins cannot include credentials, paths, insecure remote hosts or redirect the client to a non-API path', () => {
  assert.equal(apiOrigin(undefined), '');
  assert.equal(apiPath('/api/orders?id=123', ''), '/api/orders?id=123');
  assert.equal(apiPath('/api/map-tiles/{z}/{x}/{y}', 'https://api.qadam.example'), 'https://api.qadam.example/api/map-tiles/{z}/{x}/{y}');
  for (const value of ['http://api.qadam.example', 'https://user:secret@api.qadam.example', 'https://api.qadam.example/path', 'https://api.qadam.example?x=1', 'not-a-url']) {
    assert.throws(() => apiOrigin(value));
  }
  for (const path of ['//evil.example/api/orders', 'https://evil.example/api/orders', '/other', '/api\\evil']) assert.throws(() => apiPath(path, ''));
});

test('frontend-only builds require an API origin and reject server credentials', () => {
  const frontend = { QADAM_FRONTEND_ONLY: 'true', NEXT_PUBLIC_API_ORIGIN: 'https://api.qadam.example', VERCEL: '1' };
  assert.doesNotThrow(() => validateDeployment(frontend));
  for (const key of ['DATABASE_URL', 'TEST_DATABASE_URL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'GEOAPIFY_API_KEY', 'DEMO_PASSWORD']) {
    assert.throws(() => validateDeployment({ ...frontend, [key]: 'synthetic-server-only-value' }));
  }
  assert.throws(() => validateDeployment({ ...frontend, NEXT_PUBLIC_API_ORIGIN: '' }));
  assert.throws(() => validateDeployment({ ...frontend, NEXT_PUBLIC_API_ORIGIN: 'http://localhost:3102' }));
  assert.throws(() => validateDeployment({ QADAM_FRONTEND_ONLY: 'yes' }));
});

const previousOrigin = process.env.APP_ORIGIN;
after(() => { if (previousOrigin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = previousOrigin; });
test('CORS preflights accept only exact frontend origins, safe methods and required headers', () => {
  process.env.APP_ORIGIN = local.APP_ORIGIN;
  const options = (origin: string, method = 'POST', headers = 'authorization, content-type') => proxy(new NextRequest(`${local.API_ORIGIN}/api/orders`, {
    method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': headers },
  }));
  for (const origin of [local.APP_ORIGIN, 'http://localhost:3103']) {
    const response = options(origin);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(response.headers.get('Access-Control-Allow-Credentials'), 'true');
  }
  for (const response of [options('http://127.0.0.1:3104'), options('null'), options('https://evil.example'),
    options(local.APP_ORIGIN, 'DELETE'), options(local.APP_ORIGIN, 'POST', 'x-internal-secret')]) {
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
  const ordinary = proxy(new NextRequest(`${local.API_ORIGIN}/api/orders`, { headers: { Origin: local.APP_ORIGIN } }));
  for(const method of ['PUT','DELETE']){
    const business=proxy(new NextRequest(`${local.API_ORIGIN}/api/business-profile`,{method:'OPTIONS',headers:{Origin:local.APP_ORIGIN,'Access-Control-Request-Method':method,'Access-Control-Request-Headers':'authorization, content-type'}}));
    assert.equal(business.status,204);assert.match(business.headers.get('Access-Control-Allow-Methods')!,new RegExp(method));
  }
  assert.equal(ordinary.headers.get('x-middleware-next'), '1');
  assert.equal(ordinary.headers.get('Access-Control-Allow-Origin'), local.APP_ORIGIN);
  assert.match(ordinary.headers.get('Vary')!, /Origin/);
});
