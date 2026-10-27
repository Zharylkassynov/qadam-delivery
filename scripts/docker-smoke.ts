import assert from 'node:assert/strict';
import { database, closeDatabase } from '../src/lib/db';
import type { Order, User } from '../src/lib/types';

const target = new URL(process.env.DATABASE_URL ?? '');
if (process.env.QADAM_LOCAL_DOCKER !== 'true' || target.hostname !== 'db' || target.pathname !== '/qadam_docker') {
  throw new Error('Docker smoke checks may only use the isolated local database');
}
const mode = process.argv[2];
assert.ok(mode === 'create' || mode === 'verify', 'Choose create or verify');
const base = 'http://app:3000';
const requestKey = '892cb588-d04c-4856-b773-2f6bdb7ab1ab';
let cookie = '';

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: process.env.APP_ORIGIN!, ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  assert.ok(response.ok, `Docker API ${path} returned ${response.status}`);
  const session = response.headers.getSetCookie()[0];
  if (session) cookie = session.split(';')[0];
  return await response.json() as T;
}

try {
  const login = await api<{ user: User }>('/api/auth/login', {
    email: 'customer1@qadam.demo', password: process.env.DEMO_PASSWORD,
  });
  assert.equal(login.user.role, 'CUSTOMER');
  assert.ok(cookie, 'Login did not return a session');
  if (mode === 'create') {
    const result = await api<{ order: Order }>('/api/orders', {
      requestKey, pickupAddress: 'Алматы, улица Абая, 10', destinationAddress: 'Алматы, улица Ауэзова, 20',
      recipientName: 'Проверка Docker', recipientPhone: '+7 700 000 00 00', notes: 'Локальная проверка сохранности данных',
    });
    assert.equal(result.order.status, 'SEARCHING_FOR_COURIER');
  }
  const stored = await database().query('SELECT id,status FROM qadam.orders WHERE customer_id=$1 AND request_key=$2', [login.user.id, requestKey]);
  assert.equal(stored.rowCount, 1, 'Expected one persisted smoke order');
  const listed = await api<{ orders: Order[] }>('/api/orders');
  assert.ok(listed.orders.some(order => order.id === stored.rows[0].id && order.status === stored.rows[0].status));
  await api('/api/auth/logout', {});
  console.log(mode === 'create' ? 'Docker API → PostgreSQL → API verified; one synthetic order persisted.' :
    'Order and login still work after restarting both PostgreSQL and the application.');
} finally { await closeDatabase(); }
