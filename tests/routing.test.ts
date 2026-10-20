import { after, before, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { migrate } from '../scripts/migrate';
import { closeDatabase, database, transaction } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';
import { acceptOrder, createOrder } from '../src/lib/orders';
import { orderRoute } from '../src/lib/routing';
import { takeMapBudget } from '../src/lib/map-services';
import { AppError } from '../src/lib/errors';
import type { User } from '../src/lib/types';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Routing tests require a separate _test database');
process.env.DATABASE_URL = url;
const key = 'test-only-routing-key-12345678';
const users: User[] = [];
const a = { latitude: 43.241892, longitude: 76.946843 }, b = { latitude: 43.2398, longitude: 76.9239 };
const fixture = { features: [{ properties: { distance: 4277, distance_units: 'meters' }, geometry: { type: 'MultiLineString', coordinates: [[[a.longitude, a.latitude], [76.94, 43.24], [b.longitude, b.latitude]]] } }] };
const answer = () => Response.json(fixture);
const status = (work: Promise<unknown>, code: number) => assert.rejects(work, (e: unknown) => e instanceof AppError && e.status === code && !e.message.includes(key));
// These tests exercise provider/authorization outcomes, not wall-clock pacing.
// The separate quota test keeps all counters and uses concurrent requests.
async function calculate(actor: User, id: string) {
  await database().query("DELETE FROM qadam.service_limits WHERE bucket LIKE 'route:second:%'");
  return orderRoute(actor, id);
}
const create = (points = true) => createOrder(users[0], { requestKey: randomUUID(), pickupAddress: 'Тест: Абая 10', destinationAddress: 'Тест: Абая 52', recipientName: 'Тест маршрута', recipientPhone: '+77000000000', notes: 'Автотест, маршрут симулирован', ...(points ? { pickupPoint: a, destinationPoint: b } : {}) });

before(async () => {
  await migrate(); const hash = await hashPassword('Routing-test-password!');
  for (const role of ['CUSTOMER', 'CUSTOMER', 'COURIER', 'COURIER']) {
    const data = await database().query('INSERT INTO qadam.users(email,name,role,password_hash) VALUES($1,$2,$3,$4) RETURNING id,email,name,role', [`routing-${randomUUID()}@qadam.invalid`, 'Routing test', role, hash]);
    users.push(data.rows[0]);
  }
});
beforeEach(async () => { mock.restoreAll(); process.env.GEOAPIFY_API_KEY = key; await database().query('DELETE FROM qadam.service_limits'); });
after(async () => {
  mock.restoreAll();
  await transaction(async client => {
    await client.query('DELETE FROM qadam.orders WHERE customer_id=ANY($1::uuid[])', [users.map(u => u.id)]);
    await client.query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])', [users.map(u => u.id)]);
    await client.query('DELETE FROM qadam.service_limits');
  }); await closeDatabase();
});

test('route uses stored A/B points, server-only key and a daily provider cache; output is minimal Leaflet geometry', async () => {
  const order = await create();
  const fetcher = mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit & { next?: { revalidate?: number } }) => {
    const target = new URL(String(input));
    assert.equal(target.origin, 'https://api.geoapify.com'); assert.equal(target.pathname, '/v1/routing');
    assert.equal(target.searchParams.get('waypoints'), `${a.latitude},${a.longitude}|${b.latitude},${b.longitude}`);
    assert.equal(target.searchParams.get('mode'), 'drive'); assert.equal(target.searchParams.get('traffic'), 'free_flow');
    assert.equal(target.searchParams.get('apiKey'), key); assert.equal(options?.next?.revalidate, 86400); assert.equal(options?.redirect, 'error');
    assert.equal(String(input).includes(order.id), false); return answer();
  });
  const result = await calculate(users[0], order.id);
  assert.equal(fetcher.mock.calls.length, 1);
  assert.deepEqual(result, { mode: 'drive', distanceMeters: 4277, paths: [[[a.latitude, a.longitude], [43.24, 76.94], [b.latitude, b.longitude]]] });
  assert.equal(JSON.stringify(result).includes(key), false);
});

test('order access is checked before every provider/cache read, including after courier assignment', async () => {
  const order = await create(); const fetcher = mock.method(globalThis, 'fetch', async () => answer());
  await status(calculate(users[1], order.id), 404);
  await status(calculate(users[0], randomUUID()), 404); await status(calculate(users[0], '../unsafe'), 400);
  assert.equal(fetcher.mock.calls.length, 0);
  assert.ok(await calculate(users[2], order.id)); // Available deliveries follow list visibility.
  await acceptOrder(users[2], order.id);
  await status(calculate(users[3], order.id), 404);
  assert.ok(await calculate(users[0], order.id)); assert.ok(await calculate(users[2], order.id));
});

test('missing pins, missing configuration and unsupported service areas do not call the provider', async () => {
  const fetcher = mock.method(globalThis, 'fetch', async () => answer());
  delete process.env.GEOAPIFY_API_KEY;
  const without = await create(false); assert.equal(await calculate(users[0], without.id), null);
  const order = await create(); await status(calculate(users[0], order.id), 503);
  process.env.GEOAPIFY_API_KEY = key;
  await database().query('UPDATE qadam.orders SET pickup_latitude=51 WHERE id=$1', [order.id]);
  await status(calculate(users[0], order.id), 422); assert.equal(fetcher.mock.calls.length, 0);
});

test('provider outage, quota, malformed or unrelated geometry never invent a straight route or expose secrets', async () => {
  const order = await create();
  for (const code of [503, 429]) {
    mock.method(globalThis, 'fetch', async () => new Response(key, { status: code }));
    await status(calculate(users[0], order.id), code);
  }
  for (const body of ['invalid JSON', JSON.stringify({ features: [] }), JSON.stringify({ features: [{ ...fixture.features[0], geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] } }] })]) {
    mock.method(globalThis, 'fetch', async () => new Response(body)); await status(calculate(users[0], order.id), 503);
  }
  mock.method(globalThis, 'fetch', async () => { throw new Error(key); }); await status(calculate(users[0], order.id), 503);
});

test('route requests share a global daily limit across concurrent users', async () => {
  const now = Number((await database().query('SELECT extract(epoch FROM clock_timestamp())::bigint AS seconds')).rows[0].seconds);
  const bucket = `route:day:${Math.floor(now / 86400)}`;
  await database().query('INSERT INTO qadam.service_limits(bucket,hits,expires_at) VALUES($1,299,to_timestamp($2))', [bucket, now + 86400]);
  const results = await Promise.allSettled(users.map(u => takeMapBudget(u.id, 'route')));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  for (const r of results) if (r.status === 'rejected') assert.ok(r.reason instanceof AppError && r.reason.status === 429);
  assert.equal((await database().query('SELECT hits FROM qadam.service_limits WHERE bucket=$1', [bucket])).rows[0].hits, 300);
});
