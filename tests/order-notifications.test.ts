import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { database, transaction, closeDatabase } from '../src/lib/db';
import { migrate } from '../scripts/migrate';
import { createOrder, acceptOrder, transitionOrder, getOrder } from '../src/lib/orders';
import { getCourierStatus, setCourierStatus } from '../src/lib/courier-status';
import { alertWaitingOrders } from '../src/lib/order-notifications';
import { drainBotOutbox } from '../src/lib/telegram-notifications';
import { BotApiError } from '../src/lib/telegram-bot-api';
import { orderReference, orderStartParameter } from '../src/lib/order-links';
import { verifyTelegramData } from '../src/lib/telegram';
import { signedTelegramData, testBotToken } from './telegram-fixture';
import { AppError } from '../src/lib/errors';
import type { User } from '../src/lib/types';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Separate _test database required');
process.env.DATABASE_URL = url;
process.env.APP_ORIGIN = 'http://127.0.0.1:3100';
const people: User[] = [];
let customer: User, stranger: User, courier: User, other: User, excluded: User, admin: User;
const payload = () => ({ requestKey: randomUUID(), pickupAddress: 'Абая, 10, Алматы', destinationAddress: 'Ауэзова, 20, Алматы',
  recipientName: 'Секретный получатель', recipientPhone: '+77001234567', notes: 'Секретный комментарий',
  pickupPoint: { latitude: 43.24, longitude: 76.9 }, destinationPoint: { latitude: 43.25, longitude: 76.91 } });
const db = database;
const reject = (work: Promise<unknown>, status: number) => assert.rejects(work, e => e instanceof AppError && e.status === status);
const jobs = async (id: string) => (await db().query('SELECT * FROM qadam.telegram_outbox WHERE order_id=$1 ORDER BY id', [id])).rows;
before(async () => {
  await migrate();
  for (const role of ['CUSTOMER','CUSTOMER','COURIER','COURIER','COURIER','CUSTOMER'] as const) {
    const user: User = (await db().query(`INSERT INTO qadam.users(email,name,role,password_hash) VALUES($1,$2,$3,'synthetic-unused')
      RETURNING id,email,name,role`, [`notifications-${randomUUID()}@qadam.demo`, `Уведомления ${people.length}`, role])).rows[0];
    user.telegramId = String(3500000000000 + Math.floor(Math.random() * 1000000000)); people.push(user);
    await db().query('INSERT INTO qadam.telegram_identities(user_id,telegram_user_id,allows_write) VALUES($1,$2,true)', [user.id,user.telegramId]);
  }
  [customer,stranger,courier,other,excluded,admin] = people;
});
beforeEach(async () => {
  const ids = people.map(u => u.id);
  await db().query('DELETE FROM qadam.orders WHERE customer_id=ANY($1::uuid[])',[ids]);
  await db().query('DELETE FROM qadam.administrators WHERE user_id=ANY($1::uuid[])',[ids]);
  await db().query('DELETE FROM qadam.courier_applications WHERE user_id=ANY($1::uuid[])',[ids]);
  await db().query('DELETE FROM qadam.courier_status WHERE user_id=ANY($1::uuid[])',[ids]);
  await db().query('UPDATE qadam.users SET active=true WHERE id=ANY($1::uuid[])',[ids]);
  await db().query('UPDATE qadam.telegram_identities SET allows_write=true,bot_blocked_at=NULL WHERE user_id=ANY($1::uuid[])',[ids]);
});
after(async () => {
  const ids = people.map(u => u.id);
  await db().query('DELETE FROM qadam.orders WHERE customer_id=ANY($1::uuid[])',[ids]);
  await db().query('DELETE FROM qadam.courier_applications WHERE user_id=ANY($1::uuid[])',[ids]);
  await db().query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])',[ids]);
  await closeDatabase();
});

test('availability persists, expires after eight hours and rechecks the active approved courier in the database', async () => {
  assert.equal((await getCourierStatus(courier)).online,false);
  await reject(setCourierStatus({...customer,role:'COURIER'}, {online:true}),403);
  await db().query(`INSERT INTO qadam.courier_applications(user_id,phone,transport,status,reviewed_at,reviewed_by)
    VALUES($1,'+77000000000','FOOT','APPROVED',now(),$2)`,[stranger.id,admin.id]);
  assert.equal((await setCourierStatus(stranger,{online:true})).online,true);
  await assert.rejects(setCourierStatus(courier,{online:true,userId:other.id}));
  const on = await setCourierStatus(courier,{online:true}); assert.equal(on.online,true);
  assert.equal(Date.parse(on.expiresAt!)-Date.parse(on.updatedAt!),8*3600000);
  assert.equal((await getCourierStatus(courier)).online,true);
  await db().query("UPDATE qadam.courier_status SET updated_at=now()-interval '8 hours 1 second' WHERE user_id=$1",[courier.id]);
  assert.equal((await getCourierStatus(courier)).online,false);
  await setCourierStatus(courier,{online:true}); await setCourierStatus(courier,{online:false});
  assert.equal((await getCourierStatus(courier)).online,false);
  await db().query('UPDATE qadam.users SET active=false WHERE id=$1',[courier.id]);
  await reject(setCourierStatus(courier,{online:true}),403);
});

test('new-order notices require a fresh shift and permission, omit contacts and deduplicate creation retries', async () => {
  await setCourierStatus(courier,{online:true}); await setCourierStatus(other,{online:true}); await setCourierStatus(excluded,{online:true});
  await db().query("UPDATE qadam.courier_status SET updated_at=now()-interval '9 hours' WHERE user_id=$1",[other.id]);
  await db().query('UPDATE qadam.telegram_identities SET allows_write=false WHERE user_id=$1',[excluded.id]);
  const input = payload(); const [a,b] = await Promise.all([createOrder(customer,input),createOrder(customer,input)]);
  assert.equal(a.id,b.id); const queued = await jobs(a.id); assert.equal(queued.length,1);
  assert.equal(String(queued[0].telegram_user_id),courier.telegramId);
  const text = JSON.stringify(queued[0].body);
  for (const hidden of [input.recipientName,input.recipientPhone,input.notes]) assert.ok(!text.includes(hidden));
  assert.match(text,/по прямой/); assert.match(text,/order=/);
  await setCourierStatus(courier,{online:false});
  const sent: unknown[] = []; await drainBotOutbox(async (_m,b) => { sent.push(b); return {message_id:1}; },200);
  assert.equal(sent.length,0); assert.equal((await jobs(a.id))[0].failed,true);
});

test('acceptance edits other couriers messages, preserves message IDs and queues each customer status once', async () => {
  await setCourierStatus(courier,{online:true}); await setCourierStatus(other,{online:true});
  const order = await createOrder(customer,payload()); let messageId=100;
  await drainBotOutbox(async () => ({message_id:++messageId}),200);
  const saved = (await db().query('SELECT message_id FROM qadam.order_notifications WHERE order_id=$1',[order.id])).rows;
  assert.equal(saved.length,2); assert.ok(saved.every(n=>n.message_id));
  const race = await Promise.allSettled([acceptOrder(courier,order.id),acceptOrder(other,order.id)]);
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
  const winner = race[0].status==='fulfilled' ? courier : other;
  await acceptOrder(winner,order.id);
  for (const status of ['PICKED_UP','IN_TRANSIT','DELIVERED'] as const) {
    await transitionOrder(winner,order.id,status); await transitionOrder(winner,order.id,status);
  }
  const queued = await jobs(order.id), edits = queued.filter(j=>j.method==='editMessageText');
  assert.equal(edits.length,1); assert.notEqual(String(edits[0].telegram_user_id),winner.telegramId);
  assert.match(edits[0].body.text,/заказ уже принят/); assert.deepEqual(edits[0].body.reply_markup.inline_keyboard,[]);
  assert.equal(queued.filter(j=>j.dedupe_key.includes(':status:')).length,4);
  const sent: string[] = []; await drainBotOutbox(async (_m,b) => { if(String(b.chat_id)===customer.telegramId) sent.push(String(b.text)); return {message_id:++messageId}; },200);
  assert.equal(sent.length,4); assert.match(sent[0],/Курьер назначен/); assert.match(sent[3],/доставлена/);
});

test('acceptance while sendMessage is in flight still schedules the closing edit', async () => {
  await setCourierStatus(courier,{online:true}); const order = await createOrder(customer,payload());
  const methods: string[] = [];
  await drainBotOutbox(async (m,b) => {
    methods.push(m);
    if (m==='sendMessage' && String(b.chat_id)===courier.telegramId) await acceptOrder(other,order.id);
    return {message_id:650};
  },200);
  assert.ok(methods.includes('editMessageText'));
  const notice = (await db().query('SELECT * FROM qadam.order_notifications WHERE order_id=$1',[order.id])).rows[0];
  assert.equal(String(notice.message_id),'650'); assert.ok(notice.closed_at);
});

test('a queued availability notice is suppressed after acceptance; cancellation reaches the customer once', async () => {
  await setCourierStatus(courier,{online:true}); const a = await createOrder(customer,payload());
  await acceptOrder(other,a.id); const chats: string[] = [];
  await drainBotOutbox(async (_m,b) => { chats.push(String(b.chat_id)); return {message_id:1}; },200);
  assert.ok(!chats.includes(courier.telegramId!));
  const b = await createOrder(customer,payload()); await transitionOrder(customer,b.id,'CANCELLED'); await transitionOrder(customer,b.id,'CANCELLED');
  assert.equal((await jobs(b.id)).filter(j=>j.dedupe_key.endsWith(':status:CANCELLED')).length,1);
});

test('429 retries keep customer statuses ordered and 403 revokes permission without leaking transport errors', async () => {
  const a = await createOrder(customer,payload()); await acceptOrder(courier,a.id); await transitionOrder(courier,a.id,'PICKED_UP');
  const failed: string[] = []; await drainBotOutbox(async (_m,b) => { failed.push(String(b.text)); throw new BotApiError(429,30); },200);
  assert.equal(failed.length,1); assert.match(failed[0],/Курьер назначен/);
  assert.equal((await jobs(a.id))[1].attempts,0);
  await db().query('UPDATE qadam.telegram_outbox SET available_at=now() WHERE order_id=$1',[a.id]);
  const sent: string[] = []; await drainBotOutbox(async (_m,b) => { sent.push(String(b.text)); return {message_id:1}; },200);
  assert.equal(sent.length,2); assert.match(sent[1],/Посылка у курьера/);
  await transitionOrder(courier,a.id,'IN_TRANSIT');
  await drainBotOutbox(async () => { throw new BotApiError(403); },200);
  assert.equal((await db().query('SELECT allows_write FROM qadam.telegram_identities WHERE user_id=$1',[customer.id])).rows[0].allows_write,false);
});

test('waiting-order alerts atomically claim ten-minute orders, retry when no admin is reachable, and omit personal details', async () => {
  const a = await createOrder(customer,payload());
  // Keep this fixture ahead of old synthetic orders left by browser tests.
  await db().query("UPDATE qadam.orders SET created_at='2000-01-01T00:00:00Z' WHERE id=$1",[a.id]);
  await alertWaitingOrders(); assert.equal((await db().query('SELECT alerted_at FROM qadam.orders WHERE id=$1',[a.id])).rows[0].alerted_at,null);
  await db().query('INSERT INTO qadam.administrators(user_id) VALUES($1)',[admin.id]);
  await Promise.all([alertWaitingOrders(),alertWaitingOrders(),alertWaitingOrders()]);
  const queued = await jobs(a.id); assert.equal(queued.length,1); assert.match(queued[0].body.text,/10 минут/);
  assert.match(queued[0].body.reply_markup.inline_keyboard[0][0].web_app.url,/screen=adminOrders/);
  assert.ok((await db().query('SELECT alerted_at FROM qadam.orders WHERE id=$1',[a.id])).rows[0].alerted_at);
  const young = await createOrder(customer,payload()); await alertWaitingOrders(); assert.equal((await jobs(young.id)).length,0);
  await acceptOrder(courier,a.id);
  const sentToAdmin: unknown[]=[];
  // Other old synthetic orders can legitimately alert this new administrator.
  // Only the accepted order's stale notification must be suppressed.
  await drainBotOutbox(async (_m,b) => { if(String(b.chat_id)===admin.telegramId&&JSON.stringify(b.reply_markup).includes(`order=${a.id}`)) sentToAdmin.push(b); return {message_id:1}; },1000);
  assert.equal(sentToAdmin.length,0);
});

test('deep links validate UUIDs and signed start parameters, resolve old orders and enforce access after assignment', async () => {
  const a = await createOrder(customer,payload());
  assert.equal((await getOrder(customer,a.number)).id,a.id);
  const visible = await getOrder(courier,a.id); assert.equal(visible.recipientPhone,null);
  await reject(getOrder({...stranger,isAdmin:true},a.id),404);
  await reject(getOrder(customer,'9223372036854775808'),404);
  await acceptOrder(courier,a.id); await reject(getOrder(other,a.number),404);
  await db().query('INSERT INTO qadam.administrators(user_id) VALUES($1)',[admin.id]);
  assert.equal((await getOrder(admin,a.id)).recipientPhone,payload().recipientPhone);
  await db().query('DELETE FROM qadam.administrators WHERE user_id=$1',[admin.id]); await reject(getOrder(admin,a.id),404);
  assert.equal(orderStartParameter(`order_${a.number}`),a.number);
  assert.equal(verifyTelegramData(signedTelegramData({id:1234,first_name:'Ссылка'}, {start_param:`order_${a.number}`}),testBotToken).order,a.number);
  for (const bad of ['order_0','order_-1','order_1.0','order_01','order_9223372036854775808']) assert.equal(orderStartParameter(bad),undefined);
  assert.equal(orderReference('1 OR true'),undefined);
});

test('production RLS grants allow the restricted role to save availability, message IDs and alert timestamps', async () => {
  const a = await createOrder(customer,payload());
  const sql = await readFile(new URL('../db/migrations/20261027173430_order_notifications.sql',import.meta.url),'utf8');
  await transaction(async client => {
    await client.query('SAVEPOINT fixture');
    if (!(await client.query("SELECT 1 FROM pg_roles WHERE rolname='qadam_app'")).rowCount) await client.query('CREATE ROLE qadam_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT');
    await client.query('GRANT USAGE ON SCHEMA qadam TO qadam_app');
    await client.query('GRANT SELECT ON qadam.orders TO qadam_app');
    await client.query('CREATE POLICY notifications_fixture_read ON qadam.orders FOR SELECT TO qadam_app USING(true)');
    await client.query('CREATE POLICY notifications_fixture_update ON qadam.orders FOR UPDATE TO qadam_app USING(true) WITH CHECK(true)');
    for(const [table,policy] of [['courier_status','courier_status_server'],['order_notifications','order_notifications_server']]) await client.query(`DROP POLICY IF EXISTS ${policy} ON qadam.${table}`);
    await client.query(sql.slice(sql.indexOf('ALTER TABLE qadam.courier_status ENABLE ROW LEVEL SECURITY;')));
    await client.query('SET LOCAL ROLE qadam_app');
    await client.query('INSERT INTO qadam.courier_status(user_id,online) VALUES($1,true)',[courier.id]);
    await client.query('UPDATE qadam.courier_status SET online=false WHERE user_id=$1',[courier.id]);
    const n=(await client.query('INSERT INTO qadam.order_notifications(order_id,user_id,chat_id) VALUES($1,$2,$3) RETURNING id',[a.id,courier.id,courier.telegramId])).rows[0];
    await client.query('UPDATE qadam.order_notifications SET message_id=12,closed_at=now() WHERE id=$1',[n.id]);
    assert.equal((await client.query('SELECT message_id::text FROM qadam.order_notifications WHERE id=$1',[n.id])).rows[0].message_id,'12');
    await client.query('UPDATE qadam.orders SET alerted_at=now() WHERE id=$1',[a.id]);
    await client.query('RESET ROLE'); await client.query('ROLLBACK TO SAVEPOINT fixture');
  });
});
