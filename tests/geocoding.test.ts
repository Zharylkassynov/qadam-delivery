import { after, before, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { migrate } from '../scripts/migrate';
import { closeDatabase, database } from '../src/lib/db';
import { addressSearchSchema, searchAddresses } from '../src/lib/geocoding';
import { takeMapBudget } from '../src/lib/map-services';
import { AppError } from '../src/lib/errors';
import type { User } from '../src/lib/types';

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test')) throw new Error('Geocoding tests require a separate _test database');
process.env.DATABASE_URL = testUrl;
const key = 'test-only-geocoding-key-12345678';
const customer: User = { id: randomUUID(), role: 'CUSTOMER', name: 'Geocoding test', email: 'geocoding-test@qadam.invalid' };
const building = { lat: 43.24189, lon: 76.94684, country_code: 'kz', formatted: 'проспект Абая, 10, Алматы, Казахстан', address_line1: 'Казахстан', address_line2: 'Алматы', housenumber: '10', street: 'проспект Абая', result_type: 'building', rank: { confidence_building_level: 1 } };
const answer = (results: unknown[]) => new Response(JSON.stringify({ results }), { headers: { 'Content-Type': 'application/json' } });
const rejectsStatus = (work: Promise<unknown>, status: number) => assert.rejects(work, (error: unknown) => error instanceof AppError && error.status === status);
before(migrate);
beforeEach(async () => { mock.restoreAll(); process.env.GEOAPIFY_API_KEY = key; await database().query('DELETE FROM qadam.service_limits'); });
after(async () => { mock.restoreAll(); await database().query('DELETE FROM qadam.service_limits'); await closeDatabase(); });

test('search uses server credentials and Almaty filters, deduplicates house POIs and returns a useful street/house label', async () => {
  const fetcher = mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.geoapify.com'); assert.equal(url.searchParams.get('apiKey'), key);
    assert.equal(url.searchParams.get('text'), 'Алматы, Абая 10'); assert.equal(url.searchParams.get('lang'), 'ru');
    assert.ok(url.searchParams.get('filter')?.includes('countrycode:kz')); assert.equal(url.searchParams.has('userId'), false);
    return answer([{ ...building, result_type: 'amenity', lat: 43.242 }, building, { ...building, lat: 51, lon: 71 }, { ...building, country_code: 'us' }]);
  });
  const found = await searchAddresses(customer, { query: 'Алматы, Абая 10' });
  assert.equal(fetcher.mock.calls.length, 1); assert.equal(found.length, 1);
  assert.equal(found[0].address, 'проспект Абая, 10'); assert.equal(found[0].latitude, building.lat); assert.equal(found[0].precision, 'building');
  assert.equal(JSON.stringify(found).includes(key), false); assert.equal(JSON.stringify(found).includes(customer.id), false);
});

test('a street-only or low-confidence match is never represented as a confirmed house', async () => {
  mock.method(globalThis, 'fetch', async () => answer([
    { ...building, housenumber: undefined, result_type: 'street' },
    { ...building, housenumber: '11', rank: { confidence_building_level: 0.2 } },
  ]));
  const found = await searchAddresses(customer, { query: 'Алматы, Абая 10' });
  assert.equal(found.length, 2); assert.ok(found.every((item) => item.precision === 'street'));
});

test('roles, missing configuration and malicious input cannot call the provider', async () => {
  const fetcher = mock.method(globalThis, 'fetch', async () => answer([]));
  await rejectsStatus(searchAddresses({ ...customer, role: 'COURIER' }, { query: 'Алматы, Абая 10' }), 403);
  delete process.env.GEOAPIFY_API_KEY;
  await rejectsStatus(searchAddresses(customer, { query: 'Алматы, Абая 10' }), 503);
  for (const value of [{ query: 'x' }, { query: 'a'.repeat(201) }, { query: 'Абая\n10' }, { query: 'Алматы, Абая 10', url: 'https://attacker.invalid' }]) assert.equal(addressSearchSchema.safeParse(value).success, false);
  assert.equal(fetcher.mock.calls.length, 0);
});

test('provider failure, malformed data and quota exhaustion produce safe errors without echoing credentials', async () => {
  for (const code of [503, 429]) {
    mock.method(globalThis, 'fetch', async () => new Response('upstream secret content', { status: code }));
    await rejectsStatus(searchAddresses(customer, { query: 'Алматы, Абая 10' }), code);
  }
  mock.method(globalThis, 'fetch', async () => new Response('not json'));
  await rejectsStatus(searchAddresses(customer, { query: 'Алматы, Абая 10' }), 503);
  mock.method(globalThis, 'fetch', async () => { throw new Error(`Network error ${key}`); });
  await assert.rejects(searchAddresses(customer, { query: 'Алматы, Абая 10' }), (error: unknown) => error instanceof AppError && error.status === 503 && !error.message.includes(key));
});

test('parallel authenticated requests share a persistent quota across users and cannot overspend it', async () => {
  const now = Number((await database().query('SELECT extract(epoch FROM clock_timestamp())::bigint AS seconds')).rows[0].seconds);
  const bucket = `geo:day:${Math.floor(now / 86400)}`;
  await database().query('INSERT INTO qadam.service_limits(bucket,hits,expires_at) VALUES($1,999,to_timestamp($2))', [bucket, now + 86400]);
  const attempts = await Promise.allSettled(Array.from({ length: 4 }, () => takeMapBudget(randomUUID(), 'geocode')));
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
  for (const result of attempts) if (result.status === 'rejected') assert.ok(result.reason instanceof AppError && result.reason.status === 429);
  assert.equal((await database().query('SELECT hits FROM qadam.service_limits WHERE bucket=$1', [bucket])).rows[0].hits, 1000);
});
