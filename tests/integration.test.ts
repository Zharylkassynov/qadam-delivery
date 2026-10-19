import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { database, closeDatabase, transaction } from '../src/lib/db';
import { migrate } from '../scripts/migrate';
import { hashPassword, login, loginTelegram, logout, getSession } from '../src/lib/auth';
import { signedTelegramData, testBotToken } from './telegram-fixture';
import { acceptOrder, createOrder, createOrderSchema, listOrders, transitionOrder, type CreateOrder } from '../src/lib/orders';
import { AppError } from '../src/lib/errors';
import type { User } from '../src/lib/types';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a separate database ending in _test');
process.env.DATABASE_URL = url;
process.env.DEMO_AUTH_ENABLED = 'true';
const suffix = randomUUID().slice(0, 8);
const users: User[] = [];
let customer: User, otherCustomer: User, courier: User, otherCourier: User;
const password = 'Integration-test-password!';
function input(): CreateOrder {
  return { requestKey: randomUUID(), pickupAddress: 'Алматы, улица Абая, 10', destinationAddress: 'Алматы, улица Ауэзова, 20', recipientName: 'Тестовый получатель', recipientPhone: '+7 700 123 45 67', notes: 'Автоматический тест — не реальная доставка' };
}
const rejectsStatus = (work: Promise<unknown>, status: number) => assert.rejects(work, (error: unknown) => error instanceof AppError && error.status === status);

before(async () => {
  await migrate();
  const hash = await hashPassword(password);
  for (const role of ['CUSTOMER', 'CUSTOMER', 'COURIER', 'COURIER'] as const) {
    const email = `integration-${suffix}-${users.length}@qadam.demo`;
    const result = await database().query('INSERT INTO qadam.users(email,name,role,password_hash) VALUES($1,$2,$3,$4) RETURNING id,email,name,role', [email, `Тест ${users.length}`, role, hash]);
    users.push(result.rows[0]);
  }
  [customer, otherCustomer, courier, otherCourier] = users;
});

after(async () => {
  const ids = users.map((user) => user.id);
  if (ids.length) await transaction(async (client) => {
    await client.query('DELETE FROM qadam.orders WHERE customer_id=ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM qadam.login_attempts WHERE email=ANY($1::text[])', [users.map((user) => user.email)]);
    await client.query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])', [ids]);
  });
  await closeDatabase();
});

test('password login creates a persistent session with a hashed token and server role', async () => {
  const result = await login(customer.email, password);
  assert.equal(result.user.role, 'CUSTOMER');
  assert.deepEqual(await getSession(result.token), customer);
  const stored = await database().query('SELECT token_hash FROM qadam.sessions WHERE user_id=$1', [customer.id]);
  assert.equal(stored.rows[0].token_hash, createHash('sha256').update(result.token).digest('hex'));
  assert.notEqual(stored.rows[0].token_hash, result.token);
  await logout(result.token);
  assert.equal(await getSession(result.token), null);
});

test('wrong credentials, forged tokens, expired sessions and disabled users are rejected', async () => {
  await rejectsStatus(login(customer.email, 'wrong-password'), 401);
  assert.equal(await getSession('forged-token'), null);
  const first = await login(customer.email, password);
  await database().query("UPDATE qadam.sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1", [customer.id]);
  assert.equal(await getSession(first.token), null);
  const second = await login(customer.email, password);
  await database().query('UPDATE qadam.users SET active=false WHERE id=$1', [customer.id]);
  try { assert.equal(await getSession(second.token), null); }
  finally { await database().query('UPDATE qadam.users SET active=true WHERE id=$1', [customer.id]); }
});

test('demo login can be disabled explicitly', async () => {
  process.env.DEMO_AUTH_ENABLED = 'false';
  try { await rejectsStatus(login(customer.email, password), 403); }
  finally { process.env.DEMO_AUTH_ENABLED = 'true'; }
});

test('Telegram creates one customer concurrently, preserves deliveries on reopen and enforces server roles', async () => {
  const id = 1000000000000 + Math.floor(Math.random() * 1000000000);
  const proof = signedTelegramData({ id, first_name: 'Тест Telegram', role: 'COURIER' });
  process.env.TELEGRAM_AUTH_ENABLED = 'true'; process.env.TELEGRAM_BOT_TOKEN = testBotToken;
  const [a, b] = await Promise.all([loginTelegram(proof), loginTelegram(proof)]);
  users.push(a.user);
  assert.equal(a.user.id, b.user.id);
  assert.equal(a.user.role, 'CUSTOMER');
  assert.equal(a.user.telegramId, String(id));
  assert.deepEqual(await getSession(a.token), a.user);
  assert.equal((await database().query('SELECT count(*)::int AS count FROM qadam.telegram_identities WHERE telegram_user_id=$1', [String(id)])).rows[0].count, 1);
  await rejectsStatus(acceptOrder(a.user, (await createOrder(customer, input())).id), 403);
  const order = await createOrder(a.user, input());
  await acceptOrder(courier, order.id);
  for (const status of ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED'] as const) await transitionOrder(courier, order.id, status);
  await logout(a.token);
  assert.equal(await getSession(a.token), null);
  await closeDatabase();
  const reopened = await loginTelegram(proof);
  assert.equal(reopened.user.id, a.user.id);
  assert.equal((await listOrders(reopened.user)).find((item) => item.id === order.id)?.status, 'DELIVERED');
  await database().query('UPDATE qadam.users SET role=\'COURIER\' WHERE id=$1', [a.user.id]);
  assert.equal((await loginTelegram(proof)).user.role, 'COURIER');
  await database().query('UPDATE qadam.users SET active=false WHERE id=$1', [a.user.id]);
  await rejectsStatus(loginTelegram(proof), 403);
  assert.equal(await getSession(reopened.token), null);
  process.env.TELEGRAM_AUTH_ENABLED = 'false';
  await rejectsStatus(loginTelegram(proof), 403);
  delete process.env.TELEGRAM_BOT_TOKEN;
});

test('login attempt limiter rejects further attempts', async () => {
  await database().query('INSERT INTO qadam.login_attempts(email,attempts) VALUES($1,15) ON CONFLICT(email) DO UPDATE SET attempts=15,window_start=now()', [otherCustomer.email]);
  try { await rejectsStatus(login(otherCustomer.email, password), 429); }
  finally { await database().query('DELETE FROM qadam.login_attempts WHERE email=$1', [otherCustomer.email]); }
});

test('customer creates a persisted order with both creation events', async () => {
  const order = await createOrder(customer, input());
  assert.equal(order.status, 'SEARCHING_FOR_COURIER');
  assert.equal(order.customerId, customer.id);
  assert.deepEqual(order.events.map((event) => event.status), ['CREATED', 'SEARCHING_FOR_COURIER']);
  assert.ok((await listOrders(customer)).some((item) => item.id === order.id));
  assert.ok((await listOrders(courier)).some((item) => item.id === order.id));
});

test('duplicate concurrent creation produces one order; changed payload cannot reuse its key', async () => {
  const data = input();
  const [a, b] = await Promise.all([createOrder(customer, data), createOrder(customer, data)]);
  assert.equal(a.id, b.id);
  assert.equal(b.events.length, 2);
  await rejectsStatus(createOrder(customer, { ...data, notes: 'Changed request' }), 409);
});

test('two competing couriers can assign an order to exactly one courier', async () => {
  const order = await createOrder(customer, input());
  const results = await Promise.allSettled([acceptOrder(courier, order.id), acceptOrder(otherCourier, order.id)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected?.status === 'rejected' && rejected.reason instanceof AppError && rejected.reason.status === 409);
  const persisted = (await listOrders(customer)).find((item) => item.id === order.id)!;
  assert.equal(persisted.events.filter((event) => event.status === 'ACCEPTED').length, 1);
  assert.ok([courier.id, otherCourier.id].includes(persisted.courierId!));
});

test('ownership and role restrictions hold for creation, acceptance and status updates', async () => {
  await rejectsStatus(createOrder(courier, input()), 403);
  const order = await createOrder(customer, input());
  await rejectsStatus(acceptOrder(customer, order.id), 403);
  await rejectsStatus(transitionOrder(otherCustomer, order.id, 'CANCELLED'), 403);
  await rejectsStatus(transitionOrder(courier, order.id, 'PICKED_UP'), 403);
  await acceptOrder(courier, order.id);
  await rejectsStatus(transitionOrder(otherCourier, order.id, 'PICKED_UP'), 403);
  await rejectsStatus(transitionOrder(customer, order.id, 'PICKED_UP'), 403);
  assert.ok(!(await listOrders(otherCustomer)).some((item) => item.id === order.id));
  assert.ok(!(await listOrders(otherCourier)).some((item) => item.id === order.id));
});

test('only sequential transitions succeed; duplicate updates do not duplicate events', async () => {
  const order = await createOrder(customer, input());
  await acceptOrder(courier, order.id);
  await acceptOrder(courier, order.id);
  await rejectsStatus(transitionOrder(courier, order.id, 'DELIVERED'), 409);
  await rejectsStatus(transitionOrder(courier, order.id, 'CANCELLED'), 409);
  await Promise.all([transitionOrder(courier, order.id, 'PICKED_UP'), transitionOrder(courier, order.id, 'PICKED_UP')]);
  await rejectsStatus(transitionOrder(courier, order.id, 'ACCEPTED'), 409);
  await transitionOrder(courier, order.id, 'IN_TRANSIT');
  const delivered = await transitionOrder(courier, order.id, 'DELIVERED');
  assert.deepEqual(delivered.events.map((event) => event.status), ['CREATED', 'SEARCHING_FOR_COURIER', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED']);
  assert.equal((await transitionOrder(courier, order.id, 'DELIVERED')).events.length, 6);
  await rejectsStatus(transitionOrder(courier, order.id, 'IN_TRANSIT'), 409);
});

test('cancellation is allowed only before courier assignment and survives retries', async () => {
  const order = await createOrder(customer, input());
  assert.equal((await transitionOrder(customer, order.id, 'CANCELLED')).status, 'CANCELLED');
  assert.equal((await transitionOrder(customer, order.id, 'CANCELLED')).events.length, 3);
  await rejectsStatus(acceptOrder(courier, order.id), 409);
  const assigned = await createOrder(customer, input());
  await acceptOrder(courier, assigned.id);
  await rejectsStatus(transitionOrder(customer, assigned.id, 'CANCELLED'), 409);
});

test('completed orders survive connection-pool restart and a new authenticated session', async () => {
  const order = await createOrder(customer, input());
  await acceptOrder(courier, order.id);
  await transitionOrder(courier, order.id, 'PICKED_UP');
  await transitionOrder(courier, order.id, 'IN_TRANSIT');
  await transitionOrder(courier, order.id, 'DELIVERED');
  await closeDatabase();
  const { token } = await login(customer.email, password);
  const actor = (await getSession(token))!;
  const reopened = (await listOrders(actor)).find((item) => item.id === order.id)!;
  assert.equal(reopened.status, 'DELIVERED');
  assert.equal(reopened.courierId, courier.id);
  assert.equal(reopened.events.length, 6);
});

test('validation rejects client-supplied identities, malformed phones and short addresses', () => {
  assert.equal(createOrderSchema.safeParse({ ...input(), courierId: courier.id }).success, false);
  assert.equal(createOrderSchema.safeParse({ ...input(), customerId: otherCustomer.id }).success, false);
  assert.equal(createOrderSchema.safeParse({ ...input(), recipientPhone: '+++++++' }).success, false);
  assert.equal(createOrderSchema.safeParse({ ...input(), pickupAddress: '  a ' }).success, false);
});
