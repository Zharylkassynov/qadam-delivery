import { after, before, test } from 'node:test';
import { ZodError } from 'zod';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { database, closeDatabase, transaction } from '../src/lib/db';
import { migrate } from '../scripts/migrate';
import { hashPassword, login, loginTelegram, logout, getSession } from '../src/lib/auth';
import { signedTelegramData, testBotToken } from './telegram-fixture';
import { applicationSchema, decisionSchema, listApplications, listCouriers, ownApplication, reviewApplication, submitApplication } from '../src/lib/courier-applications';
import { acceptOrder, createOrder, createOrderSchema, listOrders, transitionOrder, type CreateOrder } from '../src/lib/orders';
import { AppError } from '../src/lib/errors';
import type { User } from '../src/lib/types';
import { courierTransports, transportLabels } from '../src/lib/types';
import { locationSchema, reportLocation } from '../src/lib/locations';
import { getAdminOrder, listAdminOrders } from '../src/lib/admin-orders';
import { processTelegramJobs, receiveTelegramUpdate, telegramProfile } from '../src/lib/telegram-bot';
import { BotApiError } from '../src/lib/telegram-bot-api';
import { drainBotOutbox, enqueueBotMessage } from '../src/lib/telegram-notifications';

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
  // Browser tests deliberately disable delivery and may leave queued synthetic jobs.
  // This suite owns the separate _test queue and exercises real worker ordering.
  await database().query('TRUNCATE qadam.telegram_outbox,qadam.telegram_updates');
  await database().query('DELETE FROM qadam.courier_status');
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
    const telegramIds = users.flatMap(user => user.telegramId ? [user.telegramId] : []);
    await client.query('DELETE FROM qadam.telegram_outbox WHERE telegram_user_id=ANY($1::bigint[])', [telegramIds]);
    await client.query('DELETE FROM qadam.telegram_bot_chats WHERE telegram_user_id=ANY($1::bigint[])', [telegramIds]);
    await client.query('DELETE FROM qadam.courier_applications WHERE user_id=ANY($1::uuid[]) OR reviewed_by=ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM qadam.orders WHERE customer_id=ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM qadam.login_attempts WHERE email=ANY($1::text[])', [users.map((user) => user.email)]);
    await client.query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])', [ids]);
  });
  await closeDatabase();
});

async function telegramAccount(name: string) {
  process.env.TELEGRAM_AUTH_ENABLED = 'true'; process.env.TELEGRAM_BOT_TOKEN = testBotToken;
  const proof = signedTelegramData({ id: 3000000000000 + Math.floor(Math.random() * 1000000000), first_name: name });
  const account = await loginTelegram(proof); users.push(account.user); return { ...account, proof };
}
const applicationInput = () => ({ phone: '+7 700 000 00 00', transport: 'FOOT' as const, notes: 'Автотест заявки — не реальный курьер',
  district: 'ALMALY' as const, availability: ['EVENING' as const], ageConfirmed: true as const, acceptRules: true as const });

const pointA = { latitude: 43.2389, longitude: 76.8897 };
const pointB = { latitude: 43.245, longitude: 76.91 };
const fix = () => ({ ...pointA, accuracy: 12, capturedAt: new Date().toISOString() });

test('bot start, verified contact, application notices and admin callbacks are private and deduplicated', async () => {
  const admin = await telegramAccount('Бот — администратор'), candidate = await telegramAccount('Бот — кандидат');
  await database().query('INSERT INTO qadam.administrators(user_id) VALUES($1)', [admin.user.id]);
  let updateId = Date.now(); const updateIds: number[] = [], messages: { method: string; body: Record<string, unknown> }[] = [];
  const transport = async (method: string, body: Record<string, unknown>) => { messages.push({ method, body }); return { message_id: 20 }; };
  const send = async (telegramId: string, extra: Record<string, unknown>) => {
    const update = { update_id: ++updateId, message: { message_id: 1, from: { id: Number(telegramId) }, chat: { id: Number(telegramId), type: 'private' }, ...extra } };
    updateIds.push(update.update_id); await receiveTelegramUpdate(update); await receiveTelegramUpdate(update); await processTelegramJobs(transport); return update;
  };
  try {
    const start = await send(admin.user.telegramId!, { text: '/start courier_kaspi' });
    assert.equal(messages.filter(m => m.method === 'sendMessage').length, 1);
    assert.match(JSON.stringify(messages[0].body), /screen=courier/);
    assert.match(JSON.stringify(messages[0].body), /courier_kaspi/);
    assert.equal((await database().query('SELECT count(*)::int AS n FROM qadam.telegram_updates WHERE update_id=$1', [start.update_id])).rows[0].n, 1);
    await send(candidate.user.telegramId!, { text: '/start' });
    await send(candidate.user.telegramId!, { contact: { user_id: Number(admin.user.telegramId), phone_number: '+77000000000' } });
    assert.equal((await telegramProfile(candidate.user)).phone, null);
    await send(candidate.user.telegramId!, { contact: { user_id: Number(candidate.user.telegramId), phone_number: '+7 701 000 00 00' } });
    assert.deepEqual(await telegramProfile(candidate.user), { phone: '+77010000000', allowsWrite: true });
    const application = await submitApplication(candidate.user, { ...applicationInput(), source: 'courier_kaspi' });
    await submitApplication(candidate.user, { ...applicationInput(), source: 'courier_kaspi' });
    await drainBotOutbox(transport);
    assert.equal(messages.filter(m => String(m.body.text).startsWith('Новая заявка')).length, 1);
    const callback = (telegramId: string) => ({ update_id: ++updateId, callback_query: { id: `query-${updateId}`, from: { id: Number(telegramId) }, data: `app:approve:${application.id}`, message: { message_id: 20, chat: { id: Number(telegramId), type: 'private' } } } });
    const denied = callback(candidate.user.telegramId!); updateIds.push(denied.update_id);
    await receiveTelegramUpdate(denied); await processTelegramJobs(transport);
    assert.equal((await ownApplication(candidate.user))?.status, 'PENDING');
    const allowed = callback(admin.user.telegramId!); updateIds.push(allowed.update_id);
    await receiveTelegramUpdate(allowed); await receiveTelegramUpdate(allowed); await processTelegramJobs(transport);
    assert.equal((await ownApplication(candidate.user))?.status, 'APPROVED');
    assert.equal(messages.filter(m => String(m.body.text).startsWith('Заявка одобрена!')).length, 1);
    assert.ok(messages.some(m => m.method === 'editMessageText'));
    await rejectsStatus(listCouriers(candidate.user), 403);
    const listed = (await listCouriers(admin.user)).find(item => item.id === application.id);
    assert.equal(listed?.district, 'ALMALY'); assert.deepEqual(listed?.availability, ['EVENING']);
    assert.equal(listed?.source, 'courier_kaspi');
    await database().query('UPDATE qadam.users SET active=false WHERE id=$1', [candidate.user.id]);
    assert.equal((await listCouriers(admin.user)).some(item => item.id === application.id), false);
    await database().query('UPDATE qadam.users SET active=true WHERE id=$1', [candidate.user.id]);
    // Bot failures never undo an application decision; 403 records a blocked bot.
    const next = await telegramAccount('Бот — отказ уведомлений');
    await send(next.user.telegramId!, { text: '/start' });
    const pending = await submitApplication(next.user, applicationInput());
    await reviewApplication(admin.user, pending.id, { decision: 'REJECTED', reason: 'Уточни номер телефона' });
    await drainBotOutbox(async () => { throw new BotApiError(403); });
    assert.equal((await ownApplication(next.user))?.status, 'REJECTED');
    assert.equal((await telegramProfile(next.user)).allowsWrite, false);
  } finally {
    await database().query('DELETE FROM qadam.telegram_updates WHERE update_id=ANY($1::bigint[])', [updateIds]);
    const telegramIds = users.flatMap(u => u.telegramId ? [u.telegramId] : []);
    await database().query('DELETE FROM qadam.telegram_outbox WHERE telegram_user_id=ANY($1::bigint[])', [telegramIds]);
    await database().query('DELETE FROM qadam.telegram_bot_chats WHERE telegram_user_id=ANY($1::bigint[])', [telegramIds]);
  }
});

test('bot outbox retries transient failures and competing workers send a queued message once', async () => {
  const account = await telegramAccount('Очередь бота');
  const key = `retry:${account.user.id}`;
  await enqueueBotMessage(database(), key, account.user.telegramId!, { chat_id: account.user.telegramId!, text: 'Synthetic queue test' });
  await enqueueBotMessage(database(), key, account.user.telegramId!, { chat_id: account.user.telegramId!, text: 'Synthetic queue test' });
  await drainBotOutbox(async () => { throw new BotApiError(429, 25); }, 1);
  const retry = (await database().query('SELECT attempts,failed,sent_at,available_at>now()+interval \'20 seconds\' AS delayed FROM qadam.telegram_outbox WHERE dedupe_key=$1', [key])).rows[0];
  assert.deepEqual(retry, { attempts: 1, failed: false, sent_at: null, delayed: true });
  await database().query('UPDATE qadam.telegram_outbox SET available_at=now() WHERE dedupe_key=$1', [key]);
  let sent = 0;
  const transport = async () => { sent++; await new Promise(resolve => setTimeout(resolve, 30)); return {}; };
  await Promise.all([drainBotOutbox(transport, 1), drainBotOutbox(transport, 1)]);
  assert.equal(sent, 1);
  const delivered = (await database().query('SELECT attempts,sent_at IS NOT NULL AS sent,body FROM qadam.telegram_outbox WHERE dedupe_key=$1', [key])).rows[0];
  assert.deepEqual(delivered, { attempts: 2, sent: true, body: {} });
});

test('signed start source and message permission persist; new application consents are mandatory', async () => {
  process.env.TELEGRAM_AUTH_ENABLED = 'true'; process.env.TELEGRAM_BOT_TOKEN = testBotToken;
  const account = await loginTelegram(signedTelegramData({ id: 3700000000000 + Math.floor(Math.random() * 1000000000), first_name: 'Ссылка', allows_write_to_pm: true }, { start_param: 'courier_uni' }));
  users.push(account.user);
  assert.equal(account.startScreen, 'courier'); assert.equal(account.source, 'courier_uni');
  assert.equal((await telegramProfile(account.user)).allowsWrite, true);
  const saved = await submitApplication(account.user, { ...applicationInput(), source: 'untrusted_url' });
  assert.equal(saved.source, 'courier_uni'); assert.equal(saved.ageConfirmed, true); assert.ok(saved.consentAt);
  for (const invalid of [{ ageConfirmed: false }, { acceptRules: false }, { district: 'OTHER' }, { availability: [] }, { availability: ['DAY', 'DAY'] }, { source: '../bad' }])
    assert.equal(applicationSchema.safeParse({ ...applicationInput(), ...invalid }).success, false);
});

test('restricted application role can persist bot jobs and new application fields with RLS', async () => {
  const account = await telegramAccount('Проверка прав бота');
  const migration = await readFile(new URL('../db/migrations/20261026102512_courier_bot.sql', import.meta.url), 'utf8');
  await transaction(async client => {
    await client.query('SAVEPOINT bot_role_fixture');
    if (!(await client.query("SELECT 1 FROM pg_roles WHERE rolname='qadam_app'")).rowCount)
      await client.query('CREATE ROLE qadam_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT');
    await client.query('GRANT USAGE ON SCHEMA qadam TO qadam_app');
    await client.query('GRANT SELECT ON qadam.telegram_identities,qadam.courier_applications TO qadam_app');
    await client.query('GRANT INSERT(user_id,phone,transport,notes) ON qadam.courier_applications TO qadam_app');
    await client.query('CREATE POLICY bot_fixture_identity_read ON qadam.telegram_identities FOR SELECT TO qadam_app USING(true)');
    await client.query('CREATE POLICY bot_fixture_application_read ON qadam.courier_applications FOR SELECT TO qadam_app USING(true)');
    await client.query("CREATE POLICY bot_fixture_application_insert ON qadam.courier_applications FOR INSERT TO qadam_app WITH CHECK(status='PENDING')");
    for (const [table, policy] of [['telegram_identities','telegram_server_update'], ['telegram_bot_chats','bot_chats_server'], ['telegram_updates','bot_updates_server'], ['telegram_outbox','bot_outbox_server']])
      await client.query(`DROP POLICY IF EXISTS ${policy} ON qadam.${table}`);
    // Table definitions were already migrated. Exercise the exact production grants and policies.
    await client.query(migration.slice(migration.indexOf('ALTER TABLE qadam.telegram_bot_chats ENABLE ROW LEVEL SECURITY;')));
    await client.query('SET LOCAL ROLE qadam_app');
    assert.equal((await client.query("UPDATE qadam.telegram_identities SET allows_write=true,source='courier_uni' WHERE user_id=$1 RETURNING allows_write", [account.user.id])).rows[0].allows_write, true);
    await client.query("INSERT INTO qadam.telegram_bot_chats(telegram_user_id,phone) VALUES($1,'+77010000000')", [account.user.telegramId]);
    await client.query('UPDATE qadam.telegram_bot_chats SET allows_write=false WHERE telegram_user_id=$1', [account.user.telegramId]);
    await client.query("INSERT INTO qadam.telegram_updates(update_id,payload) VALUES(9007199254740000,'{}')");
    await client.query('UPDATE qadam.telegram_updates SET processed_at=now() WHERE update_id=9007199254740000');
    assert.ok((await client.query("INSERT INTO qadam.telegram_outbox(dedupe_key,telegram_user_id,method,body) VALUES($1,$2,'sendMessage','{}') RETURNING id", [`rls:${account.user.id}`, account.user.telegramId])).rows[0].id);
    const saved = await client.query(`INSERT INTO qadam.courier_applications(user_id,phone,transport,notes,district,availability,age_confirmed,consent_at,source)
      VALUES($1,'+77010000000','FOOT','','ALMALY',ARRAY['DAY'],true,now(),'courier_uni') RETURNING district,age_confirmed`, [account.user.id]);
    assert.deepEqual(saved.rows[0], { district: 'ALMALY', age_confirmed: true });
    await client.query('SAVEPOINT identity_write_denied');
    await assert.rejects(client.query('UPDATE qadam.telegram_identities SET user_id=user_id WHERE user_id=$1', [account.user.id]), (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '42501');
    await client.query('ROLLBACK TO SAVEPOINT identity_write_denied');
    await client.query('RESET ROLE');
    await client.query('ROLLBACK TO SAVEPOINT bot_role_fixture');
  });
  assert.equal((await telegramProfile(account.user)).allowsWrite, false);
});

test('restricted application role can read and append events with RLS, but cannot change history', async () => {
  const order = await createOrder(customer, input());
  const migration = await readFile(new URL('../db/migrations/20261026095352_order_events_rls.sql', import.meta.url), 'utf8');
  await transaction(async client => {
    // Roles are cluster-wide: roll all temporary grants, policies and role creation back.
    await client.query('SAVEPOINT role_fixture');
    if (!(await client.query("SELECT 1 FROM pg_roles WHERE rolname='qadam_app'")).rowCount)
      await client.query('CREATE ROLE qadam_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT');
    await client.query('GRANT USAGE ON SCHEMA qadam TO qadam_app');
    await client.query(migration);
    await client.query(migration); // Reapplying the ready-to-run SQL is safe.
    const policies = (await client.query("SELECT cmd,roles::text[] AS roles FROM pg_policies WHERE schemaname='qadam' AND tablename='order_events' ORDER BY cmd")).rows;
    assert.deepEqual(policies.map(p => p.cmd), ['INSERT', 'SELECT']);
    for (const policy of policies) assert.deepEqual(policy.roles, ['qadam_app']);
    const privileges = (await client.query(`SELECT
      has_table_privilege('qadam_app','qadam.order_events','UPDATE') AS update,
      has_table_privilege('qadam_app','qadam.order_events','DELETE') AS delete`)).rows[0];
    assert.deepEqual(privileges, { update: false, delete: false });
    await client.query('SET LOCAL ROLE qadam_app');
    assert.equal((await client.query('SELECT count(*)::int AS count FROM qadam.order_events WHERE order_id=$1', [order.id])).rows[0].count, 2);
    await client.query("INSERT INTO qadam.order_events(order_id,actor_id,status) VALUES($1,$2,'CREATED')", [order.id, customer.id]);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM qadam.order_events WHERE order_id=$1', [order.id])).rows[0].count, 3);
    for (const query of ['UPDATE qadam.order_events SET status=status WHERE order_id=$1', 'DELETE FROM qadam.order_events WHERE order_id=$1']) {
      await client.query('SAVEPOINT denied_write');
      await assert.rejects(client.query(query, [order.id]), (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '42501');
      await client.query('ROLLBACK TO SAVEPOINT denied_write');
      await client.query('RELEASE SAVEPOINT denied_write');
    }
    await client.query('RESET ROLE');
    await client.query('ROLLBACK TO SAVEPOINT role_fixture');
  });
  assert.equal((await listOrders(customer)).find(o => o.id === order.id)!.events.length, 2);
});

test('recipient contacts stay private until assignment, including retries and administrator access', async () => {
  const data = input();
  const created = await createOrder(customer, data);
  const contacts = (order: { recipientName: string | null; recipientPhone: string | null }) => [order.recipientName, order.recipientPhone];
  const expected = [data.recipientName, data.recipientPhone];
  assert.deepEqual(contacts(created), expected);
  assert.deepEqual(contacts(await createOrder(customer, data)), expected);
  for (const actor of [courier, otherCourier, { ...courier, isAdmin: true as const }]) {
    const available = (await listOrders(actor)).find(order => order.id === created.id)!;
    assert.deepEqual(contacts(available), [null, null]);
    assert.equal(available.pickupAddress, data.pickupAddress);
    assert.equal(available.destinationAddress, data.destinationAddress);
  }
  // A courier may also be an administrator; only actual membership grants access.
  const administrator = await telegramAccount('Администратор контактов');
  await database().query("UPDATE qadam.users SET role='COURIER' WHERE id=$1", [administrator.user.id]);
  const adminCourier = { ...administrator.user, role: 'COURIER' as const };
  await database().query('INSERT INTO qadam.administrators(user_id) VALUES($1)', [adminCourier.id]);
  try {
    assert.deepEqual(contacts((await listOrders(adminCourier)).find(order => order.id === created.id)!), expected);
    assert.deepEqual(contacts(await getAdminOrder(adminCourier, created.id)), expected);
    assert.deepEqual(contacts((await listAdminOrders(adminCourier)).orders.find(order => order.id === created.id)!), expected);
  } finally { await database().query('DELETE FROM qadam.administrators WHERE user_id=$1', [adminCourier.id]); }
  assert.deepEqual(contacts((await listOrders({ ...adminCourier, isAdmin: true })).find(order => order.id === created.id)!), [null, null]);
  assert.deepEqual(contacts(await acceptOrder(courier, created.id)), expected);
  assert.deepEqual(contacts(await acceptOrder(courier, created.id)), expected);
  assert.deepEqual(contacts((await listOrders(courier)).find(order => order.id === created.id)!), expected);
  assert.equal((await listOrders(otherCourier)).some(order => order.id === created.id), false);
  assert.deepEqual(contacts((await listOrders(customer)).find(order => order.id === created.id)!), expected);
  for (const status of ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED'] as const) {
    assert.deepEqual(contacts(await transitionOrder(courier, created.id, status)), expected);
    assert.deepEqual(contacts(await transitionOrder(courier, created.id, status)), expected);
  }
});

test('admin observation checks private membership, reads other customers and cannot change their deliveries', async () => {
  const admin = await telegramAccount('Наблюдатель');
  const order = await createOrder(otherCustomer, input());
  for (const actor of [customer, courier, { ...customer, isAdmin: true as const }]) {
    await rejectsStatus(listAdminOrders(actor), 403);
    await rejectsStatus(getAdminOrder(actor, order.id), 403);
  }
  await database().query('INSERT INTO qadam.administrators(user_id) VALUES($1)', [admin.user.id]);
  const observed = await getAdminOrder(admin.user, order.id);
  assert.equal(observed.customerId, otherCustomer.id); assert.equal(observed.courierId, null);
  assert.equal(observed.status, 'SEARCHING_FOR_COURIER');
  assert.equal(observed.recipientPhone, input().recipientPhone);
  await rejectsStatus(acceptOrder(admin.user, order.id), 403);
  await rejectsStatus(transitionOrder(admin.user, order.id, 'CANCELLED'), 403);
  await rejectsStatus(reportLocation(admin.user, order.id, fix()), 403);
  await acceptOrder(courier, order.id); await reportLocation(courier, order.id, fix());
  for (const status of ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED'] as const) await transitionOrder(courier, order.id, status);
  const restored = await getAdminOrder(admin.user, order.id);
  assert.equal(restored.status, 'DELIVERED'); assert.equal(restored.courierId, courier.id);
  assert.equal(restored.courierLocation?.latitude, pointA.latitude);
  assert.deepEqual(restored.events.map(e => e.status), ['CREATED', 'SEARCHING_FOR_COURIER', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED']);
  assert.equal((await listOrders(admin.user)).some(o => o.id === order.id), false);
  await logout(admin.token);
});

test('admin search, status counters and stable pagination cover orders beyond the ordinary user list', async () => {
  const admin = await telegramAccount('Список заказов');
  await database().query('INSERT INTO qadam.administrators(user_id) VALUES($1)', [admin.user.id]);
  const marker = `Наблюдение-${randomUUID()}`;
  const orders = [];
  for (let i = 0; i < 6; i++) orders.push(await createOrder(i % 2 ? customer : otherCustomer, { ...input(), pickupAddress: `${marker}, ${i}` }));
  await acceptOrder(courier, orders[0].id); await acceptOrder(otherCourier, orders[1].id);
  for (const s of ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED'] as const) await transitionOrder(otherCourier, orders[1].id, s);
  await transitionOrder(otherCustomer, orders[2].id, 'CANCELLED');
  await database().query("UPDATE qadam.orders SET created_at='2026-10-01T10:00:00Z' WHERE id=ANY($1::uuid[])", [orders.map(o => o.id)]);
  const pages = await Promise.all([0, 2, 4].map(offset => listAdminOrders(admin.user, { search: marker.toUpperCase(), limit: 2, offset })));
  assert.deepEqual(pages[0].counts, { all: 6, unassigned: 3, active: 4, history: 2 });
  assert.deepEqual(pages.flatMap(p => p.orders.map(o => o.id)), orders.map(o => o.id).sort().reverse());
  for (const [filter, total] of [['unassigned', 3], ['active', 4], ['history', 2]] as const) {
    const page = await listAdminOrders(admin.user, { search: marker, filter });
    assert.equal(page.total, total); assert.equal(page.orders.length, total);
  }
  assert.equal((await listAdminOrders(admin.user, { search: `qd-${orders[0].number.padStart(4, '0')}` })).orders[0].id, orders[0].id);
  assert.equal((await listAdminOrders(admin.user, { search: `${marker}%_` })).total, 0);
  for (const invalid of [{ limit: 101 }, { offset: -1 }, { filter: 'DROP TABLE' }, { search: 'x'.repeat(101) }, { isAdmin: true }]) await rejectsStatus(listAdminOrders(admin.user, invalid), 400);
  await rejectsStatus(getAdminOrder(admin.user, randomUUID()), 404);
  await logout(admin.token);
});

test('revoked or disabled admin loses order observation with an existing session; approved transport is readable', async () => {
  const admin = await telegramAccount('Отзыв наблюдателя'), candidate = await telegramAccount('Курьер наблюдения');
  await database().query('INSERT INTO qadam.administrators(user_id) VALUES($1)', [admin.user.id]);
  const application = await submitApplication(candidate.user, { ...applicationInput(), transport: 'ELECTRIC_MOPED' });
  await reviewApplication(admin.user, application.id, { decision: 'APPROVED', reason: '' });
  const courierSession = await getSession(candidate.token); assert.equal(courierSession?.role, 'COURIER');
  const order = await createOrder(customer, input()); await acceptOrder(courierSession!, order.id);
  assert.equal((await getAdminOrder(admin.user, order.id)).courierTransport, 'ELECTRIC_MOPED');
  const saved = { ...admin.user, isAdmin: true as const };
  await database().query('DELETE FROM qadam.administrators WHERE user_id=$1', [admin.user.id]);
  await rejectsStatus(listAdminOrders(saved), 403); await rejectsStatus(getAdminOrder(saved, order.id), 403);
  assert.equal((await getSession(admin.token))?.isAdmin, undefined);
  await database().query('INSERT INTO qadam.administrators(user_id) VALUES($1)', [admin.user.id]);
  await database().query('UPDATE qadam.users SET active=false WHERE id=$1', [admin.user.id]);
  await rejectsStatus(getAdminOrder(saved, order.id), 403);
  await database().query('UPDATE qadam.users SET active=true WHERE id=$1', [admin.user.id]);
  await logout(admin.token); await logout(candidate.token);
});

test('map points persist with idempotent order creation; old text-only orders and invalid coordinates are handled', async () => {
  const data = { ...input(), pickupPoint: pointA, destinationPoint: pointB };
  const first = await createOrder(customer, data), retry = await createOrder(customer, data);
  assert.equal(first.id, retry.id); assert.deepEqual(first.pickupPoint, pointA); assert.deepEqual(first.destinationPoint, pointB);
  await rejectsStatus(createOrder(customer, { ...data, pickupPoint: pointB }), 409);
  const old = await createOrder(customer, input()); assert.equal(old.pickupPoint, null); assert.equal(old.courierLocation, null);
  for (const point of [{ latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }, { latitude: NaN, longitude: 1 }, { latitude: Infinity, longitude: 1 }, { ...pointA, courierId: courier.id }]) {
    assert.equal(createOrderSchema.safeParse({ ...input(), pickupPoint: point }).success, false);
  }
});

test('only the assigned courier can send a location; customers and other couriers cannot read another delivery location', async () => {
  const order = await createOrder(customer, { ...input(), pickupPoint: pointA, destinationPoint: pointB });
  await rejectsStatus(reportLocation(customer, order.id, fix()), 403);
  await rejectsStatus(reportLocation(courier, order.id, fix()), 403);
  await acceptOrder(courier, order.id);
  await rejectsStatus(reportLocation(otherCourier, order.id, fix()), 403);
  const sent = await reportLocation(courier, order.id, fix()); assert.equal(sent.latitude, pointA.latitude);
  const visible = (await listOrders(customer)).find((value) => value.id === order.id)!;
  assert.equal(visible.courierLocation?.longitude, pointA.longitude); assert.ok(visible.courierLocation?.receivedAt);
  assert.equal((await listOrders(otherCustomer)).some((value) => value.id === order.id), false);
  assert.equal((await listOrders(otherCourier)).some((value) => value.id === order.id), false);
  for (const invalid of [{ ...fix(), accuracy: -1 }, { ...fix(), latitude: 100 }, { ...fix(), courierId: otherCourier.id }, { ...fix(), capturedAt: 'yesterday' }]) assert.equal(locationSchema.safeParse(invalid).success, false);
  await rejectsStatus(reportLocation(courier, order.id, { ...fix(), capturedAt: new Date(Date.now() - 121000).toISOString() }), 400);
  await rejectsStatus(reportLocation(courier, order.id, { ...fix(), capturedAt: new Date(Date.now() + 31000).toISOString() }), 400);
});

test('delayed GPS fixes cannot overwrite newer locations; throttling, completion and reopening preserve the last point', async () => {
  const order = await createOrder(customer, input()); await acceptOrder(courier, order.id);
  const first = { ...fix(), capturedAt: new Date(Date.now() - 3000).toISOString() };
  await reportLocation(courier, order.id, first);
  await reportLocation(courier, order.id, { ...first, latitude: 1, capturedAt: new Date(Date.now() - 5000).toISOString() });
  assert.equal((await listOrders(customer)).find((o) => o.id === order.id)!.courierLocation?.latitude, pointA.latitude);
  await rejectsStatus(reportLocation(courier, order.id, fix()), 429);
  await database().query("UPDATE qadam.courier_locations SET received_at=now()-interval '6 seconds' WHERE order_id=$1", [order.id]);
  await reportLocation(courier, order.id, { ...fix(), ...pointB, accuracy: null });
  await transitionOrder(courier, order.id, 'PICKED_UP'); await transitionOrder(courier, order.id, 'IN_TRANSIT');
  await transitionOrder(courier, order.id, 'DELIVERED');
  await rejectsStatus(reportLocation(courier, order.id, fix()), 409);
  await closeDatabase();
  const reopened = (await listOrders(customer)).find((o) => o.id === order.id)!;
  assert.equal(reopened.status, 'DELIVERED'); assert.equal(reopened.courierLocation?.latitude, pointB.latitude);
  assert.equal(reopened.courierLocation?.accuracy, null); assert.equal(reopened.events.length, 6);
});

test('Telegram application submission is private and concurrent retries create one pending request', async () => {
  const a = await telegramAccount('Заявитель'), b = await telegramAccount('Другой заявитель');
  const data = applicationInput();
  const [first, retry] = await Promise.all([submitApplication(a.user, data), submitApplication(a.user, data)]);
  assert.equal(first.id, retry.id); assert.equal(first.status, 'PENDING');
  assert.equal((await ownApplication(a.user))?.id, first.id);
  assert.equal(await ownApplication(b.user), null);
  await rejectsStatus(submitApplication(a.user, { ...data, notes: 'Другие данные' }), 409);
  await rejectsStatus(submitApplication(customer, data), 403);
  await rejectsStatus(listApplications({ ...a.user, isAdmin: true }), 403);
  await rejectsStatus(reviewApplication({ ...a.user, isAdmin: true }, first.id, { decision: 'APPROVED', reason: '' }), 403);
  assert.equal((await getSession(a.token))?.role, 'CUSTOMER');
});

test('all four current transport choices persist and are visible to an administrator after reopening', async () => {
  const admin = await telegramAccount('Тест транспорта — администратор');
  await database().query('INSERT INTO qadam.administrators(user_id) VALUES($1)', [admin.user.id]);
  assert.deepEqual(courierTransports.map(value => transportLabels[value]), ['Пеший', 'Электромопед', 'Мопед', 'Автомобиль']);
  for (const transport of courierTransports) {
    const applicant = await telegramAccount(`Тест транспорта ${transport}`);
    const data = applicationSchema.parse({ ...applicationInput(), transport });
    const saved = await submitApplication(applicant.user, data);
    await closeDatabase();
    assert.equal((await ownApplication(applicant.user))?.transport, transport);
    assert.equal((await listApplications(admin.user)).find(a => a.id === saved.id)?.transport, transport);
  }
});

test('legacy bicycle applications stay readable and approvable, but new bicycle or unknown transport submissions are rejected', async () => {
  const admin = await telegramAccount('Тест старой заявки — администратор'), applicant = await telegramAccount('Тест старого велосипеда');
  await database().query('INSERT INTO qadam.administrators(user_id) VALUES($1)', [admin.user.id]);
  const legacy = await database().query("INSERT INTO qadam.courier_applications(user_id,phone,transport,notes) VALUES($1,$2,'BICYCLE',$3) RETURNING id", [applicant.user.id, '+77000000000', 'Историческая заявка — автотест']);
  assert.equal((await ownApplication(applicant.user))?.transport, 'BICYCLE');
  const approved = await reviewApplication(admin.user, legacy.rows[0].id, { decision: 'APPROVED', reason: '' });
  assert.equal(approved.transport, 'BICYCLE'); assert.equal((await getSession(applicant.token))?.role, 'COURIER');
  const next = await telegramAccount('Тест недопустимого транспорта');
  for (const transport of ['BICYCLE', 'PLANE', '', 'электромопед']) {
    const input = { ...applicationInput(), transport };
    assert.equal(applicationSchema.safeParse(input).success, false);
    await assert.rejects(submitApplication(next.user, input as never), ZodError);
  }
  assert.equal(await ownApplication(next.user), null);
});

test('admin approval grants courier delivery access to existing and reopened sessions, with immutable audit', async () => {
  const admin = await telegramAccount('Администратор'), applicant = await telegramAccount('Будущий курьер');
  await database().query('INSERT INTO qadam.administrators(user_id) VALUES($1)', [admin.user.id]);
  const adminSession = (await getSession(admin.token))!;
  assert.equal(adminSession.isAdmin, true); assert.equal(adminSession.role, 'CUSTOMER');
  const pending = await submitApplication(applicant.user, applicationInput());
  assert.ok((await listApplications(adminSession)).some((a) => a.id === pending.id));
  const [approved, repeated] = await Promise.all([reviewApplication(adminSession, pending.id, { decision: 'APPROVED', reason: '' }), reviewApplication(adminSession, pending.id, { decision: 'APPROVED', reason: '' })]);
  assert.equal(approved.status, 'APPROVED'); assert.equal(approved.reviewer, admin.user.name);
  assert.deepEqual(approved.reviewedAt, repeated.reviewedAt);
  await rejectsStatus(reviewApplication(adminSession, pending.id, { decision: 'REJECTED', reason: 'Передумал одобрять' }), 409);
  await rejectsStatus(submitApplication(applicant.user, applicationInput()), 409);
  const approvedUser = (await getSession(applicant.token))!; assert.equal(approvedUser.role, 'COURIER');
  assert.equal((await database().query('SELECT role FROM qadam.users WHERE id=$1', [applicant.user.id])).rows[0].role, 'CUSTOMER');
  const order = await createOrder(adminSession, input()); await acceptOrder(approvedUser, order.id);
  for (const status of ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED'] as const) await transitionOrder(approvedUser, order.id, status);
  await closeDatabase();
  assert.equal((await loginTelegram(applicant.proof)).user.role, 'COURIER');
  assert.equal((await listOrders((await getSession(applicant.token))!)).find((o) => o.id === order.id)?.status, 'DELIVERED');
  assert.equal((await getSession(admin.token))?.role, 'CUSTOMER');
});

test('rejection persists, allows a new application and competing decisions cannot overwrite history', async () => {
  const admin = await telegramAccount('Проверяющий'), applicant = await telegramAccount('Повторная заявка');
  await database().query('INSERT INTO qadam.administrators(user_id) VALUES($1)', [admin.user.id]);
  const first = await submitApplication(applicant.user, applicationInput());
  const rejected = await reviewApplication(admin.user, first.id, { decision: 'REJECTED', reason: 'Уточните телефон для связи' });
  await closeDatabase();
  assert.equal((await ownApplication(applicant.user))?.decisionReason, rejected.decisionReason);
  assert.equal((await getSession(applicant.token))?.role, 'CUSTOMER');
  const second = await submitApplication(applicant.user, { ...applicationInput(), phone: '+7 701 000 00 00' });
  assert.notEqual(second.id, first.id);
  const decisions = await Promise.allSettled([reviewApplication(admin.user, second.id, { decision: 'APPROVED', reason: '' }), reviewApplication(admin.user, second.id, { decision: 'REJECTED', reason: 'Нужны дополнительные данные' })]);
  assert.equal(decisions.filter((d) => d.status === 'fulfilled').length, 1);
  const conflict = decisions.find((d) => d.status === 'rejected');
  assert.ok(conflict?.status === 'rejected' && conflict.reason instanceof AppError && conflict.reason.status === 409);
  assert.equal((await database().query('SELECT status,decision_reason FROM qadam.courier_applications WHERE id=$1', [first.id])).rows[0].decision_reason, rejected.decisionReason);
});

test('revoked administrators and disabled applicants cannot be approved; body roles and reviewer IDs are rejected', async () => {
  const admin = await telegramAccount('Отозванный доступ'), applicant = await telegramAccount('Отключённый заявитель');
  await database().query('INSERT INTO qadam.administrators(user_id) VALUES($1)', [admin.user.id]);
  const pending = await submitApplication(applicant.user, applicationInput());
  await database().query('UPDATE qadam.users SET active=false WHERE id=$1', [applicant.user.id]);
  await rejectsStatus(reviewApplication(admin.user, pending.id, { decision: 'APPROVED', reason: '' }), 409);
  await database().query('DELETE FROM qadam.administrators WHERE user_id=$1', [admin.user.id]);
  await rejectsStatus(listApplications({ ...admin.user, isAdmin: true }), 403);
  assert.equal((await getSession(admin.token))?.isAdmin, undefined);
  assert.equal(applicationSchema.safeParse({ ...applicationInput(), role: 'COURIER' }).success, false);
  assert.equal(applicationSchema.safeParse({ ...applicationInput(), userId: admin.user.id }).success, false);
  assert.equal(decisionSchema.safeParse({ decision: 'REJECTED', reason: '' }).success, false);
  assert.equal(decisionSchema.safeParse({ decision: 'APPROVED', reviewedBy: admin.user.id }).success, false);
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
