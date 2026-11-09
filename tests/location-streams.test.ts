import {before,beforeEach,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {database,closeDatabase,transaction} from '../src/lib/db';
import {migrate} from '../scripts/migrate';
import {createOrder,acceptOrder,transitionOrder,getOrder} from '../src/lib/orders';
import {setCourierStatus,getCourierStatus} from '../src/lib/courier-status';
import {saveLocationSettings} from '../src/lib/courier-location-settings';
import {streamStatus,changeLocationStream} from '../src/lib/order-location-streams';
import {receiveTelegramUpdate} from '../src/lib/telegram-bot';
import {locationConsentVersion} from '../src/lib/location-consent';
import {updateCourierPresence,nearbyCouriers} from '../src/lib/courier-presence';
import {reportLocation} from '../src/lib/locations';
import {manageOrder} from '../src/lib/order-management';
import {changeCourierBlock} from '../src/lib/courier-blocks';
import {AppError} from '../src/lib/errors';
import type {Order,User} from '../src/lib/types';
import {POST as preferencesAPI} from '../src/app/api/courier/location-preferences/route';
import {POST as streamAPI} from '../src/app/api/orders/[id]/location-stream/route';
import {readFile} from 'node:fs/promises';
import {readyCourier} from './courier-ready-fixture';

const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test')||!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw new Error('Local isolated _test database required');
process.env.DATABASE_URL=url;process.env.TELEGRAM_WORKER_ENABLED='false';process.env.APP_ORIGIN='http://127.0.0.1:3100';
const users:User[]=[],updates:number[]=[];let customer:User,courier:User,replacement:User,admin:User,token='';let counter=Date.now()*100;
const next=()=>++counter;
const reject=(value:Promise<unknown>,status:number)=>assert.rejects(value,e=>e instanceof AppError&&e.status===status);
const payload=()=>({requestKey:randomUUID(),pickupAddress:'Синтетический адрес забора',destinationAddress:'Синтетический адрес доставки',recipientName:'Получатель',recipientPhone:'+77000000000',notes:''});
const start=(order:Order,key=randomUUID())=>({action:'START',requestKey:key,expectedVersion:order.assignmentVersion,consentVersion:locationConsentVersion});
async function assigned(){await readyCourier(courier);const order=await createOrder(customer,payload());return acceptOrder(courier,order.id);}
function message(overrides:Record<string,unknown>={}){
  const date=Math.floor(Date.now()/1000)+2;
  return {message_id:100,date,from:{id:Number(courier.telegramId),is_bot:false},chat:{id:Number(courier.telegramId),type:'private'},location:{latitude:43.24,longitude:76.9,horizontal_accuracy:25,live_period:900},...overrides};
}
async function receive(m:Record<string,unknown>,edited=false,id=next()){
  updates.push(id);await receiveTelegramUpdate({update_id:id,[edited?'edited_message':'message']:m});return id;
}
async function bind(order:Order){await changeLocationStream(courier,order.id,start(order));const m=message();const update=await receive(m);return{m,update};}
before(async()=>{
  await migrate();
  for(const [i,role]of (['CUSTOMER','COURIER','COURIER','CUSTOMER'] as const).entries()){
    const u=(await database().query("INSERT INTO qadam.users(email,name,password_hash,role) VALUES($1,$2,'unused',$3) RETURNING id,email,name,role",[`stream-${randomUUID()}@qadam.invalid`,`Location fixture ${i}`,role])).rows[0] as User;
    u.telegramId=String(5600000000000+Math.floor(Math.random()*1000000000));users.push(u);
    await database().query('INSERT INTO qadam.telegram_identities(user_id,telegram_user_id) VALUES($1,$2)',[u.id,u.telegramId]);
  }
  [customer,courier,replacement,admin]=users;
  await database().query('INSERT INTO qadam.administrators(user_id) VALUES($1)',[admin.id]);
  token=randomBytes(32).toString('hex');await database().query("INSERT INTO qadam.sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[courier.id,createHash('sha256').update(token).digest('hex')]);
});
beforeEach(async()=>{
  process.env.DELIVERY_PROOF_ENABLED='false';process.env.TELEGRAM_LIVE_LOCATION_ENABLED='true';process.env.TELEGRAM_LIVE_LOCATION_PILOT_ONLY='true';process.env.TELEGRAM_LIVE_LOCATION_PILOT_IDS=courier.telegramId;
  await database().query('UPDATE qadam.pricing_settings SET active=false,config=NULL');
  await database().query('DELETE FROM qadam.orders WHERE customer_id=$1',[customer.id]);
  await database().query('DELETE FROM qadam.courier_block_events WHERE user_id=ANY($1::uuid[]) OR actor_id=ANY($1::uuid[])',[users.map(u=>u.id)]);
  await database().query('DELETE FROM qadam.courier_blocks WHERE user_id=ANY($1::uuid[])',[users.map(u=>u.id)]);
  await database().query('DELETE FROM qadam.courier_presence WHERE user_id=ANY($1::uuid[])',[users.map(u=>u.id)]);
  await setCourierStatus(courier,{online:true});await setCourierStatus(replacement,{online:true});
});
after(async()=>{
  await database().query('DELETE FROM qadam.telegram_updates WHERE update_id=ANY($1::bigint[])',[updates]);
  await database().query('DELETE FROM qadam.orders WHERE customer_id=$1',[customer.id]);
  await database().query('DELETE FROM qadam.courier_block_events WHERE user_id=ANY($1::uuid[]) OR actor_id=ANY($1::uuid[])',[users.map(u=>u.id)]);
  await database().query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])',[users.map(u=>u.id)]);await closeDatabase();
});

test('auto GPS requires versioned opt-in, survives another shift, and can be revoked',async()=>{
  assert.equal((await getCourierStatus(courier)).autoLocationEnabled,false);
  await reject(saveLocationSettings(courier,{autoEnabled:true}),400);await reject(saveLocationSettings(customer,{autoEnabled:true,consentVersion:locationConsentVersion}),403);
  await saveLocationSettings(courier,{autoEnabled:true,consentVersion:locationConsentVersion});
  await setCourierStatus(courier,{online:false});await setCourierStatus(courier,{online:true});
  assert.equal((await getCourierStatus(courier)).locationSharing,true);
  await saveLocationSettings(courier,{revoke:true});await setCourierStatus(courier,{online:false});await setCourierStatus(courier,{online:true});
  assert.equal((await getCourierStatus(courier)).locationSharing,false);assert.equal((await getCourierStatus(courier)).autoLocationEnabled,false);
});

test('closed pilot and assignment gates cannot be bypassed by another courier or a disabled flag',async()=>{
  const order=await assigned();await reject(changeLocationStream(replacement,order.id,start(order)),403);
  process.env.TELEGRAM_LIVE_LOCATION_ENABLED='false';await reject(changeLocationStream(courier,order.id,start(order)),403);
  process.env.TELEGRAM_LIVE_LOCATION_ENABLED='true';process.env.TELEGRAM_LIVE_LOCATION_PILOT_IDS='1';await reject(changeLocationStream(courier,order.id,start(order)),403);
  process.env.TELEGRAM_LIVE_LOCATION_PILOT_IDS=courier.telegramId;await changeLocationStream(courier,order.id,start(order));
  const second=await createOrder(customer,payload());const also=await acceptOrder(courier,second.id);await reject(changeLocationStream(courier,also.id,start(also)),409);
});

test('a lost START response is idempotent and its retry cannot reopen a stopped stream',async()=>{
  const order=await assigned(),body=start(order),a=await changeLocationStream(courier,order.id,body),b=await changeLocationStream(courier,order.id,body);
  assert.equal(a.stream?.id,b.stream?.id);
  await changeLocationStream(courier,order.id,{action:'STOP',streamId:a.stream!.id,expectedVersion:order.assignmentVersion});
  assert.equal((await changeLocationStream(courier,order.id,body)).stream?.state,'STOPPED');
  assert.notEqual((await changeLocationStream(courier,order.id,start(order))).stream?.id,a.stream?.id);
});

test('new own live message binds, edits update the last point, and raw coordinates never enter the queue',async()=>{
  const order=await assigned(),{m,update}=await bind(order);
  assert.equal((await streamStatus(courier,order.id)).stream?.state,'LIVE');
  assert.equal((await getOrder(customer,order.id)).courierLocation?.source,'TELEGRAM_LIVE');
  const later={...m,edit_date:m.date+2,location:{...m.location,latitude:43.25}};
  await receive(later,true);assert.equal((await getOrder(customer,order.id)).courierLocation?.latitude,43.25);
  assert.equal((await streamStatus(courier,order.id)).stream?.updateCount,2);
  const queue=(await database().query('SELECT payload FROM qadam.telegram_updates WHERE update_id=$1',[update])).rows[0].payload;
  assert.ok(!JSON.stringify(queue).includes('latitude'));assert.ok(!JSON.stringify(queue).includes('longitude'));
});

test('static points, forwarded locations, another sender and pre-consent streams cannot bind',async()=>{
  const order=await assigned();await changeLocationStream(courier,order.id,start(order));
  const m=message();
  for(const value of [message({location:{latitude:43.24,longitude:76.9}}),message({forward_origin:{}}),message({from:{id:Number(replacement.telegramId)}}),message({date:m.date-60}),message({edit_date:m.date})])await receive(value);
  assert.equal((await streamStatus(courier,order.id)).stream?.state,'WAITING');assert.equal((await getOrder(customer,order.id)).courierLocation?.source,'MINI_APP');
});

test('duplicates, another message and out-of-order edits cannot move the marker or increase its counter',async()=>{
  const order=await assigned(),{m,update}=await bind(order);
  await receive(m,false,update);await receive({...m,message_id:101,edit_date:m.date+1},true);
  const id=next();await receive({...m,edit_date:m.date+3,location:{...m.location,latitude:43.26}},true,id);
  await receive({...m,edit_date:m.date+2,location:{...m.location,latitude:43.27}},true,id-1);
  assert.equal((await getOrder(customer,order.id)).courierLocation?.latitude,43.26);
  assert.equal((await streamStatus(courier,order.id)).stream?.updateCount,2);
});

test('a stop edit closes only the bound message and delayed live edits cannot restart it',async()=>{
  const order=await assigned(),{m}=await bind(order);
  await receive({...m,edit_date:m.date+1,location:{latitude:43.24,longitude:76.9}},true);
  assert.equal((await streamStatus(courier,order.id)).stream?.state,'STOPPED');
  await receive({...m,edit_date:m.date+3,location:{...m.location,latitude:43.29}},true);
  assert.equal((await getOrder(customer,order.id)).courierLocation?.latitude,43.24);
});

test('a previously bound message cannot be reused by a new session even if Telegram retries it immediately',async()=>{
  const order=await assigned(),{m}=await bind(order),old=(await streamStatus(courier,order.id)).stream!;
  await changeLocationStream(courier,order.id,{action:'STOP',requestKey:randomUUID(),streamId:old.id,expectedVersion:order.assignmentVersion});
  await changeLocationStream(courier,order.id,start(order));await receive(m);
  assert.equal((await streamStatus(courier,order.id)).stream?.state,'WAITING');
  await receive({...m,message_id:101});assert.equal((await streamStatus(courier,order.id)).stream?.state,'LIVE');
});

test('Mini App cannot overwrite Telegram coordinates and private stream positions stay off the public map',async()=>{
  const order=await assigned();await bind(order);
  const fix={latitude:43.29,longitude:76.92,accuracy:20,capturedAt:new Date(Date.now()+5000).toISOString()};
  await reject(reportLocation(courier,order.id,fix),409);
  await updateCourierPresence(courier,{sharing:true,consent:true});await updateCourierPresence(courier,fix);
  assert.equal((await getOrder(customer,order.id)).courierLocation?.latitude,43.24);
  assert.ok(!(await nearbyCouriers(customer)).some(p=>Math.abs(p.latitude-43.29)<.005&&Math.abs(p.longitude-76.92)<.005));
});

test('shift off, blocking, revocation and reassignment close the previous binding',async()=>{
  for(const end of ['SHIFT','BLOCK','REVOKE','ASSIGN']){
    const order=await assigned(),{m}=await bind(order);
    if(end==='SHIFT'){await setCourierStatus(courier,{online:false});await database().query("UPDATE qadam.courier_status SET online=false WHERE user_id=$1",[courier.id]);}
    if(end==='BLOCK')await changeCourierBlock(admin,courier.id,{requestKey:randomUUID(),blocked:true,expectedBlocked:false,reason:'Согласованная проверка доступа'});
    if(end==='REVOKE')await saveLocationSettings(courier,{revoke:true});
    if(end==='ASSIGN')await manageOrder(admin,order.id,{action:'ASSIGN',requestKey:randomUUID(),expectedVersion:order.assignmentVersion,expectedStatus:order.status,expectedCourierId:courier.id,courierId:replacement.id,reason:'Проверка смены назначения'});
    await receive({...m,edit_date:m.date+3,location:{...m.location,latitude:43.3}},true);
    assert.equal((await database().query('SELECT state FROM qadam.order_location_streams WHERE order_id=$1',[order.id])).rows[0].state,'STOPPED');
    assert.notEqual((await getOrder(customer,order.id)).courierLocation?.latitude,43.3);
    await database().query('DELETE FROM qadam.orders WHERE id=$1',[order.id]);await database().query('DELETE FROM qadam.courier_blocks WHERE user_id=$1',[courier.id]);await setCourierStatus(courier,{online:true});
  }
});

test('completion rejects further live updates and retains only the final known point',async()=>{
  const order=await assigned(),{m}=await bind(order);await transitionOrder(courier,order.id,'PICKED_UP');await transitionOrder(courier,order.id,'IN_TRANSIT');await transitionOrder(courier,order.id,'DELIVERED');
  await receive({...m,edit_date:m.date+2,location:{...m.location,latitude:43.3}},true);
  assert.equal((await getOrder(customer,order.id)).courierLocation?.latitude,43.24);assert.equal((await streamStatus(courier,order.id)).stream?.state,'STOPPED');
});

test('waiting timeout, expired stream and stale provider events do not refresh a position',async()=>{
  const order=await assigned();await changeLocationStream(courier,order.id,start(order));
  await database().query("UPDATE qadam.order_location_streams SET created_at=clock_timestamp()-interval '6 minutes',expires_at=clock_timestamp()+interval '5 minutes' WHERE order_id=$1",[order.id]);
  assert.equal((await streamStatus(courier,order.id)).stream?.state,'STOPPED');
  await bind(order);await database().query("UPDATE qadam.order_location_streams SET expires_at=clock_timestamp()-interval '1 minute' WHERE order_id=$1",[order.id]);
  await receive(message({edit_date:Math.floor(Date.now()/1000)-100}),true);
  assert.equal((await streamStatus(courier,order.id)).stream?.state,'STOPPED');
});

test('new APIs authenticate requests and reject a wrong origin and unapproved consent version',async()=>{
  const order=await assigned(),context={params:Promise.resolve({id:order.id})};
  const req=(body:unknown,authenticated=true,origin='http://127.0.0.1:3100')=>new Request(`${origin}/api/test`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(authenticated?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
  assert.equal((await preferencesAPI(req({autoEnabled:false},false))).status,401);
  assert.equal((await streamAPI(req(start(order),true,'https://evil.invalid'),context)).status,403);
  assert.equal((await preferencesAPI(req({autoEnabled:true,consentVersion:'unapproved'}))).status,400);
  assert.equal((await streamAPI(req(start(order)),context)).status,200);
});

test('stream RLS and restricted role grants are installed by the migration',async()=>{
  await transaction(async db=>{
    if(!(await db.query("SELECT 1 FROM pg_roles WHERE rolname='qadam_app'")).rowCount)await db.query('CREATE ROLE qadam_app NOLOGIN');
    await db.query('GRANT USAGE ON SCHEMA qadam TO qadam_app');await db.query('DROP POLICY IF EXISTS order_location_streams_server ON qadam.order_location_streams');
    const sql=await readFile('db/migrations/20261101103834_courier_location_streams.sql','utf8');await db.query(sql.match(/DO \$\$ DECLARE api_role text; BEGIN[\s\S]*?END; \$\$;/)![0]);
    await db.query('GRANT SELECT ON qadam.courier_locations TO qadam_app');
    await db.query(await readFile('db/migrations/20261101112310_location_source_permissions.sql','utf8'));
    assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='qadam.order_location_streams'::regclass")).rows[0].relrowsecurity,true);
    await db.query('SET LOCAL ROLE qadam_app');await db.query('SELECT 1 FROM qadam.order_location_streams LIMIT 0');await db.query("UPDATE qadam.order_location_streams SET state='STOPPED' WHERE false");await db.query('UPDATE qadam.courier_locations SET location_source=location_source WHERE false');await db.query('RESET ROLE');
    // Keep the test-created role and policy out of subsequent fixtures.
    throw new AppError(418,'rollback fixture');
  }).catch(error=>{if(!(error instanceof AppError&&error.status===418))throw error;});
});
