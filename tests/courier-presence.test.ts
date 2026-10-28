import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {database,closeDatabase,transaction} from '../src/lib/db';
import {migrate} from '../scripts/migrate';
import {setCourierStatus,getCourierStatus} from '../src/lib/courier-status';
import {updateCourierPresence,nearbyCouriers} from '../src/lib/courier-presence';
import {createOrder,acceptOrder,transitionOrder,getOrder} from '../src/lib/orders';
import {AppError} from '../src/lib/errors';
import type {User} from '../src/lib/types';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Separate _test database required');
process.env.DATABASE_URL=url;
const people:User[]=[];let customer:User,courier:User,other:User;
const fix=(offset=0)=>({latitude:43.241123,longitude:76.895678,accuracy:18,capturedAt:new Date(Date.now()+offset).toISOString()});
const reject=(p:Promise<unknown>,status:number)=>assert.rejects(p,e=>e instanceof AppError&&e.status===status);
const input=()=>({requestKey:randomUUID(),pickupAddress:'Алматы, Абая 10',destinationAddress:'Алматы, Ауэзова 20',recipientName:'Получатель GPS',recipientPhone:'+77000000000',notes:''});
const begin=async()=>{await setCourierStatus(courier,{online:true});await updateCourierPresence(courier,{sharing:true,consent:true});};
const relax=()=>database().query("UPDATE qadam.courier_presence SET received_at=clock_timestamp()-interval '6 seconds' WHERE user_id=$1",[courier.id]);
before(async()=>{await migrate();for(const role of ['CUSTOMER','COURIER','CUSTOMER'] as const){people.push((await database().query("INSERT INTO qadam.users(email,name,role,password_hash) VALUES($1,'GPS fixture',$2,'unused') RETURNING id,email,name,role",[`presence-${randomUUID()}@qadam.demo`,role])).rows[0]);}[customer,courier,other]=people;});
beforeEach(async()=>{const ids=people.map(u=>u.id);await database().query('DELETE FROM qadam.orders WHERE customer_id=ANY($1::uuid[])',[ids]);await database().query('DELETE FROM qadam.courier_presence WHERE user_id=ANY($1::uuid[])',[ids]);await database().query('DELETE FROM qadam.courier_status WHERE user_id=ANY($1::uuid[])',[ids]);await database().query('UPDATE qadam.users SET active=true WHERE id=ANY($1::uuid[])',[ids]);});
after(async()=>{const ids=people.map(u=>u.id);await database().query('DELETE FROM qadam.orders WHERE customer_id=ANY($1::uuid[])',[ids]);await database().query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])',[ids]);await closeDatabase();});

test('GPS needs an active approved courier, fresh shift and explicit consent, never a client-supplied identity',async()=>{
  await reject(updateCourierPresence({...customer,role:'COURIER'},fix()),403);
  await reject(updateCourierPresence(courier,fix()),403);
  await setCourierStatus(courier,{online:true});await reject(updateCourierPresence(courier,fix()),403);
  await assert.rejects(updateCourierPresence(courier,{sharing:true,consent:false}));
  await assert.rejects(updateCourierPresence(courier,{...fix(),userId:other.id}));
  await updateCourierPresence(courier,{sharing:true,consent:true});await updateCourierPresence(courier,fix());
  const state=await getCourierStatus(courier);assert.equal(state.locationSharing,true);assert.ok(state.locationConsentAt);assert.equal(state.location?.latitude,fix().latitude);
  await database().query('UPDATE qadam.users SET active=false WHERE id=$1',[courier.id]);await reject(updateCourierPresence(courier,fix()),403);
});
test('public map rounds on the server, groups cells, exposes no identities, and applies bounds after rounding',async()=>{
  await begin();await updateCourierPresence(courier,fix());const rows=await nearbyCouriers(customer);
  const p=rows.find(p=>Math.abs(p.latitude-fix().latitude)<.01)!;assert.ok(p);assert.notEqual(p.latitude,fix().latitude);assert.notEqual(p.longitude,fix().longitude);
  assert.deepEqual(Object.keys(p).sort(),['capturedAt','count','latitude','longitude']);
  const narrow=await nearbyCouriers(customer,{south:fix().latitude-.000001,north:fix().latitude+.000001,west:fix().longitude-.000001,east:fix().longitude+.000001});assert.equal(narrow.length,0);
  await reject(nearbyCouriers(courier),403);await reject(nearbyCouriers(customer,{south:-90,north:90,west:-180,east:180}),400);
});
test('offline, expired, disabled, nonconsenting and stale couriers disappear without deleting order history',async()=>{
  await begin();await updateCourierPresence(courier,fix());
  await setCourierStatus(courier,{online:false});assert.ok(!(await nearbyCouriers(customer)).some(p=>Math.abs(p.latitude-fix().latitude)<.01));
  await setCourierStatus(courier,{online:true});await relax();await updateCourierPresence(courier,fix(1000));
  await database().query("UPDATE qadam.courier_status SET updated_at=now()-interval '9 hours' WHERE user_id=$1",[courier.id]);await reject(updateCourierPresence(courier,fix()),409);
  await setCourierStatus(courier,{online:true});await updateCourierPresence(courier,{sharing:false});await reject(updateCourierPresence(courier,fix()),403);
  await updateCourierPresence(courier,{sharing:true,consent:true});await updateCourierPresence(courier,fix());
  await database().query("UPDATE qadam.courier_presence SET captured_at=now()-interval '91 seconds' WHERE user_id=$1",[courier.id]);assert.ok(!(await nearbyCouriers(customer)).some(p=>Math.abs(p.latitude-fix().latitude)<.01));
});
test('outdated and future fixes are rejected, retries cannot move a marker back, and frequent writes are throttled',async()=>{
  await begin();await reject(updateCourierPresence(courier,fix(-91000)),400);await reject(updateCourierPresence(courier,fix(31000)),400);
  const a=fix();await updateCourierPresence(courier,a);assert.equal((await updateCourierPresence(courier,a)).location?.latitude,a.latitude);
  await reject(updateCourierPresence(courier,fix(1000)),429);await relax();const b={...fix(1000),latitude:43.25};await updateCourierPresence(courier,b);
  assert.equal((await updateCourierPresence(courier,a)).location?.latitude,b.latitude);
});
test('one shift feed updates all active assigned orders and completed deliveries keep their final point',async()=>{
  await begin();const first=fix();await updateCourierPresence(courier,first);
  const a=await createOrder(customer,input()),b=await createOrder(customer,input());await acceptOrder(courier,a.id);await acceptOrder(courier,b.id);
  assert.equal((await getOrder(customer,a.id)).courierLocation?.latitude,first.latitude);
  await reject(getOrder(other,a.id),404);
  assert.ok(!(await nearbyCouriers(customer)).some(p=>Math.abs(p.latitude-first.latitude)<.01));
  for(const s of ['PICKED_UP','IN_TRANSIT','DELIVERED'] as const)await transitionOrder(courier,a.id,s);
  await relax();await updateCourierPresence(courier,{...fix(2000),latitude:43.26});
  assert.equal((await getOrder(customer,a.id)).courierLocation?.latitude,first.latitude);assert.equal((await getOrder(customer,b.id)).courierLocation?.latitude,43.26);
});
test('turning off consent races GPS safely and requires a new measurement before appearing again',async()=>{
  await begin();await updateCourierPresence(courier,fix());await relax();
  await Promise.allSettled([updateCourierPresence(courier,{sharing:false}),updateCourierPresence(courier,fix(1000))]);
  assert.equal((await getCourierStatus(courier)).locationSharing,false);assert.ok(!(await nearbyCouriers(customer)).some(p=>Math.abs(p.latitude-fix().latitude)<.01));
  await updateCourierPresence(courier,{sharing:true,consent:true});assert.equal((await getCourierStatus(courier)).location,null);
});
test('production RLS grants let qadam_app persist its GPS state and deny client roles',async()=>{
  const sql=await readFile(new URL('../db/migrations/20261028053350_courier_presence.sql',import.meta.url),'utf8');
  await transaction(async db=>{
    await db.query('SAVEPOINT gps_fixture');if(!(await db.query("SELECT 1 FROM pg_roles WHERE rolname='qadam_app'")).rowCount)await db.query('CREATE ROLE qadam_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT');
    await db.query('GRANT USAGE ON SCHEMA qadam TO qadam_app');await db.query('DROP POLICY IF EXISTS courier_presence_server ON qadam.courier_presence');
    await db.query(sql.slice(sql.indexOf('ALTER TABLE qadam.courier_presence ENABLE ROW LEVEL SECURITY;')));
    await db.query('SET LOCAL ROLE qadam_app');await db.query('INSERT INTO qadam.courier_presence(user_id,sharing,consent_at) VALUES($1,true,now())',[courier.id]);
    await db.query('UPDATE qadam.courier_presence SET latitude=43.24,longitude=76.9,captured_at=now(),received_at=now() WHERE user_id=$1',[courier.id]);
    assert.equal((await db.query('SELECT latitude FROM qadam.courier_presence WHERE user_id=$1',[courier.id])).rows[0].latitude,43.24);
    await db.query('RESET ROLE');await db.query('ROLLBACK TO SAVEPOINT gps_fixture');
  });
});
