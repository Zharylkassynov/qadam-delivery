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
