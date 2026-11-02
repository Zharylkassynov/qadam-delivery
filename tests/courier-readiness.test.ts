import {before,beforeEach,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {database,closeDatabase} from '../src/lib/db';
import {migrate} from '../scripts/migrate';
import {getCourierStatus,setCourierStatus} from '../src/lib/courier-status';
import {saveLocationSettings} from '../src/lib/courier-location-settings';
import {updateCourierPresence,nearbyCouriers} from '../src/lib/courier-presence';
import {acceptOrder,createOrder,getOrder,transitionOrder} from '../src/lib/orders';
import {reportLocation} from '../src/lib/locations';
import {locationConsentVersion} from '../src/lib/location-consent';
import {AppError} from '../src/lib/errors';
import type {User} from '../src/lib/types';
import {POST as acceptAPI} from '../src/app/api/orders/[id]/accept/route';

const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test')||!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw new Error('Local _test database required');
process.env.DATABASE_URL=url;process.env.TELEGRAM_WORKER_ENABLED='false';
process.env.APP_ORIGIN='http://127.0.0.1:3100';
let customer:User,courier:User,token='';const users:User[]=[];
const input=()=>({requestKey:randomUUID(),pickupAddress:'Адрес проверки геопозиции',destinationAddress:'Адрес получателя проверки',recipientName:'Получатель',recipientPhone:'+77000000000',notes:''});
const fix=()=>({latitude:43.19,longitude:76.81,accuracy:20,capturedAt:new Date().toISOString()});
const denied=(promise:Promise<unknown>,status:number)=>assert.rejects(promise,e=>e instanceof AppError&&e.status===status);
async function agree(){await saveLocationSettings(courier,{autoEnabled:true,consentVersion:locationConsentVersion});}
async function ready(){await agree();await setCourierStatus(courier,{online:true});await updateCourierPresence(courier,fix());}
async function assigned(){await ready();const order=await createOrder(customer,input());return acceptOrder(courier,order.id);}
async function finish(id:string){for(const state of ['PICKED_UP','IN_TRANSIT','DELIVERED'] as const)await transitionOrder(courier,id,state);}
before(async()=>{
  await migrate();for(const role of ['CUSTOMER','COURIER'] as const)users.push((await database().query("INSERT INTO qadam.users(email,name,role,password_hash) VALUES($1,'Readiness fixture',$2,'unused') RETURNING id,email,name,role",[`readiness-${randomUUID()}@qadam.invalid`,role])).rows[0]);
  [customer,courier]=users;token=randomBytes(32).toString('hex');
  await database().query("INSERT INTO qadam.sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[courier.id,createHash('sha256').update(token).digest('hex')]);
});
beforeEach(async()=>{
  process.env.DELIVERY_PROOF_ENABLED='false';await database().query('UPDATE qadam.pricing_settings SET active=false,config=NULL');
  await database().query('DELETE FROM qadam.orders WHERE customer_id=$1',[customer.id]);
  await database().query('DELETE FROM qadam.courier_status WHERE user_id=$1',[courier.id]);
  await database().query('DELETE FROM qadam.courier_presence WHERE user_id=$1',[courier.id]);
});
after(async()=>{await database().query('DELETE FROM qadam.orders WHERE customer_id=$1',[customer.id]);await database().query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])',[users.map(u=>u.id)]);await closeDatabase();});

test('new acceptance requires a real fresh shift position, not merely permission or consent',async()=>{
  const order=await createOrder(customer,input());await denied(acceptOrder(courier,order.id),409);
  await setCourierStatus(courier,{online:true});await denied(acceptOrder(courier,order.id),409);
  await agree();await setCourierStatus(courier,{online:true});await denied(acceptOrder(courier,order.id),409);
  await updateCourierPresence(courier,fix());assert.equal((await getCourierStatus(courier)).canAccept,true);
  assert.equal((await acceptOrder(courier,order.id)).courierId,courier.id);
});
test('old consent cannot authorize new position collection or acceptance',async()=>{
  await agree();await setCourierStatus(courier,{online:true});
  await database().query("UPDATE qadam.courier_presence SET auto_consent_version='2026-11-01-v1' WHERE user_id=$1",[courier.id]);
  await denied(updateCourierPresence(courier,fix()),403);
  assert.equal((await getCourierStatus(courier)).consentCurrent,false);
  const order=await createOrder(customer,input());await denied(acceptOrder(courier,order.id),409);
});
test('stale measurement or server receipt independently prevents acceptance and map exposure',async()=>{
  await ready();const order=await createOrder(customer,input());
  for(const column of ['captured_at','received_at']){
    await database().query(`UPDATE qadam.courier_presence SET ${column}=clock_timestamp()-interval '91 seconds' WHERE user_id=$1`,[courier.id]);
    assert.equal((await getCourierStatus(courier)).canAccept,false);await denied(acceptOrder(courier,order.id),409);
    assert.ok(!(await nearbyCouriers(customer)).some(p=>Math.abs(p.latitude-43.19)<.003&&Math.abs(p.longitude-76.81)<.004));
    await database().query('UPDATE qadam.courier_presence SET captured_at=clock_timestamp(),received_at=clock_timestamp() WHERE user_id=$1',[courier.id]);
  }
});
test('a previous-shift position cannot reactivate readiness; repeated online requests preserve expiry',async()=>{
  await ready();const before=await getCourierStatus(courier);await setCourierStatus(courier,{online:true});
  assert.equal((await getCourierStatus(courier)).updatedAt,before.updatedAt);
  await setCourierStatus(courier,{online:false});await setCourierStatus(courier,{online:true});
  assert.equal((await getCourierStatus(courier)).location,null);assert.equal((await getCourierStatus(courier)).canAccept,false);
  await updateCourierPresence(courier,fix());assert.equal((await getCourierStatus(courier)).canAccept,true);
});
test('end after delivery preserves the current order, stops new acceptance and does not extend the shift',async()=>{
  const order=await assigned(),before=await getCourierStatus(courier),next=await createOrder(customer,input());
  const status=await setCourierStatus(courier,{online:false});assert.equal(status.online,true);assert.equal(status.endingAfterDelivery,true);
  assert.equal(status.acceptingOrders,false);assert.equal(status.canAccept,false);assert.equal(status.updatedAt,before.updatedAt);
  await denied(acceptOrder(courier,next.id),409);assert.equal((await getOrder(customer,order.id)).status,'ACCEPTED');
  assert.equal((await acceptOrder(courier,order.id)).id,order.id);
});
test('the last of multiple active deliveries closes shift and public GPS; earlier completion does not',async()=>{
  const first=await assigned(),second=await createOrder(customer,input());await acceptOrder(courier,second.id);
  await setCourierStatus(courier,{online:false});await finish(first.id);assert.equal((await getCourierStatus(courier)).online,true);
  await finish(second.id);const status=await getCourierStatus(courier);assert.equal(status.online,false);assert.equal(status.locationSharing,false);assert.equal(status.location,null);
});
test('missing readiness alone never requests automatic shift ending for a previous application',async()=>{
  const order=await assigned();await database().query('UPDATE qadam.courier_status SET accepting_orders=false,end_after_delivery=false WHERE user_id=$1',[courier.id]);
  assert.equal((await getCourierStatus(courier)).endingAfterDelivery,false);await finish(order.id);
  assert.equal((await getCourierStatus(courier)).online,true);
});
test('cancellation and assignment removal also finalize an ending shift through database triggers',async()=>{
  for(const change of ["status='CANCELLED'","courier_id=NULL,status='SEARCHING_FOR_COURIER'"]){
    const order=await assigned();await setCourierStatus(courier,{online:false});
    await database().query(`UPDATE qadam.orders SET ${change} WHERE id=$1`,[order.id]);
    assert.equal((await getCourierStatus(courier)).online,false);
  }
});
test('revocation stops new writes immediately, retains an honestly marked last point and allows delivery completion',async()=>{
  const order=await assigned(),previous=order.courierLocation!;
  await saveLocationSettings(courier,{revoke:true});const status=await getCourierStatus(courier);
  assert.equal(status.canAccept,false);assert.equal(status.consentCurrent,false);
  const saved=(await getOrder(customer,order.id)).courierLocation!;
  assert.equal(saved.capturedAt,previous.capturedAt);assert.equal(saved.sharingStopped,true);
  await denied(updateCourierPresence(courier,fix()),403);await denied(reportLocation(courier,order.id,fix()),403);
  assert.equal((await acceptOrder(courier,order.id)).id,order.id);await finish(order.id);
  assert.equal((await getCourierStatus(courier)).online,false);
});
test('ending a shift and accepting a new order serialize without losing an assigned delivery',async()=>{
  for(let i=0;i<5;i++){
    await ready();const order=await createOrder(customer,input());
    const [accept]=await Promise.allSettled([acceptOrder(courier,order.id),setCourierStatus(courier,{online:false})]);
    const saved=await getOrder(customer,order.id),status=await getCourierStatus(courier);
    assert.equal(status.canAccept,false);
    if(accept.status==='fulfilled'){assert.equal(saved.courierId,courier.id);assert.equal(status.endingAfterDelivery,true);await finish(order.id);}
    else{assert.equal(saved.courierId,null);assert.equal(status.online,false);}
  }
});
test('the real acceptance API rejects missing auth, foreign origins and missing GPS then accepts a ready courier',async()=>{
  const order=await createOrder(customer,input()),context={params:Promise.resolve({id:order.id})};
  const request=(auth:boolean,origin='http://127.0.0.1:3100')=>new Request(`${origin}/api/orders/${order.id}/accept`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${token}`}:{})},body:'{}'});
  assert.equal((await acceptAPI(request(false),context)).status,401);
  assert.equal((await acceptAPI(request(true,'https://foreign.invalid'),context)).status,403);
  assert.equal((await acceptAPI(request(true),context)).status,409);await ready();
  assert.equal((await acceptAPI(request(true),context)).status,200);
});
test('GPS, revocation and cancellation cannot deadlock or restore a finished-shift point',async()=>{
  for(const work of ['GPS','REVOKE','SHIFT']){
    const order=await assigned();await setCourierStatus(courier,{online:false});
    await database().query("UPDATE qadam.courier_presence SET received_at=clock_timestamp()-interval '6 seconds' WHERE user_id=$1",[courier.id]);
    const results=await Promise.allSettled([
      work==='GPS'?updateCourierPresence(courier,fix()):work==='REVOKE'?saveLocationSettings(courier,{revoke:true}):setCourierStatus(courier,{online:false}),
      database().query("UPDATE qadam.orders SET status='CANCELLED' WHERE id=$1",[order.id]),
    ]);
    for(const result of results)if(result.status==='rejected')assert.ok(result.reason instanceof AppError&&[403,409].includes(result.reason.status));
    const status=await getCourierStatus(courier);assert.equal(status.online,false);assert.equal(status.location,null);
  }
});
