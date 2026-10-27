import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseConfig } from '../src/lib/db-config';

test('local PostgreSQL keeps the existing non-TLS development connection', () => {
  const config = databaseConfig('postgresql://qadam:local@127.0.0.1:55432/qadam_delivery', {});
  assert.equal(config.ssl, undefined);
  assert.equal(config.max, 5);
});

test('cloud connection requires TLS and retains certificate verification with sslmode=require', () => {
  const config = databaseConfig('postgresql://qadam_app.ref:example@aws-example.pooler.supabase.com:5432/postgres?sslmode=require', {});
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.equal(new URL(config.connectionString!).searchParams.has('sslmode'), false);
  assert.equal(config.max, 3);
});

test('cloud configuration rejects disabled TLS and unreasonable pool sizes', () => {
  assert.throws(() => databaseConfig('postgresql://user:example@example.com/postgres?sslmode=disable', {}));
  assert.throws(() => databaseConfig('postgresql://user:example@example.com/postgres?ssl=no-verify', {}));
  assert.throws(() => databaseConfig('postgresql://user:example@example.com/postgres', { DATABASE_POOL_MAX: '50' }));
});

test('Vercel keeps verified TLS with a short idle timeout and a reusable pool', () => {
  const config = databaseConfig('postgresql://qadam_app.ref:example@aws-example.pooler.supabase.com:6543/postgres', { VERCEL: '1' });
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.equal(config.idleTimeoutMillis, 5000);
  assert.equal(config.max, 3);
});

test('only an explicit local Docker mode allows the private db:5432 connection without TLS', () => {
  const url = 'postgresql://qadam:synthetic@db:5432/qadam_docker';
  const config = databaseConfig(url, { QADAM_LOCAL_DOCKER: 'true' });
  assert.equal(config.ssl, undefined);
  assert.equal(config.max, 5);
  assert.deepEqual(databaseConfig(url, {}).ssl, { rejectUnauthorized: true });
  for (const connection of [url.replace('@db:', '@example.com:'), url.replace(':5432/', ':6543/'), `${url}?sslmode=disable`]) {
    assert.throws(() => databaseConfig(connection, { QADAM_LOCAL_DOCKER: 'true' }));
  }
  assert.throws(() => databaseConfig(url, { QADAM_LOCAL_DOCKER: 'true', VERCEL: '1' }));
  assert.throws(() => databaseConfig(url, { QADAM_LOCAL_DOCKER: 'yes' }));
});
