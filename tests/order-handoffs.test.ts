import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {database,closeDatabase} from '../src/lib/db';
import {migrate} from '../scripts/migrate';
import {AppError} from '../src/lib/errors';
import type {Order,User} from '../src/lib/types';
import {createOrder,acceptOrder,transitionOrder,getOrder} from '../src/lib/orders';
import {completeOrder,uploadOrderPhoto} from '../src/lib/order-proof';
import {confirmHandoff,correctHandoffPoint,handoffPresence,issueHandoffCode,viewHandoffCode} from '../src/lib/order-handoffs';
import {lockedOrder} from '../src/lib/trust-core';
import {releaseOrder,manageOrder} from '../src/lib/order-management';
import {orderTrustInfo} from '../src/lib/trust-info';
import {handoffsEnabled} from '../src/lib/handoff-settings';
import {readyCourier} from './courier-ready-fixture';
import {reportLocation} from '../src/lib/locations';
import {changeCourierBlock} from '../src/lib/courier-blocks';
import {POST as handoffAPI} from '../src/app/api/orders/[id]/handoff/route';
import {GET as codeAPI,POST as issueAPI} from '../src/app/api/orders/[id]/handoff-code/route';
import {recipientLink,publicRecipientDelivery} from '../src/lib/recipient-tracking';
import {ensureHandoffEnforcement} from '../src/lib/handoff-activation';

const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test')||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('Separate local test DB required');
process.env.DATABASE_URL=url;process.env.APP_ORIGIN='http://127.0.0.1:3100';process.env.DELIVERY_HANDOFFS_ENABLED='true';process.env.DELIVERY_PROOF_ENABLED='false';process.env.TELEGRAM_WORKER_ENABLED='false';process.env.DELIVERY_CODE_SECRET=randomBytes(32).toString('hex');
const users:User[]=[];let customer:User,courier:User,other:User,admin:User;
const tokens=new Map<string,string>();
const A={latitude:43.24,longitude:76.9},B={latitude:43.25,longitude:76.91},far={latitude:43.45,longitude:77.25};
const input=()=>({requestKey:randomUUID(),pickupAddress:'Алматы, Абая 100',destinationAddress:'Алматы, Самал 111',pickupPoint:A,destinationPoint:B,recipientName:'Получатель',recipientPhone:'+77000000011',notes:''});
const fields=(order:Order)=>({requestKey:randomUUID(),expectedVersion:order.assignmentVersion??0,expectedRouteVersion:order.routeVersion??0});
const reject=(work:Promise<unknown>,status:number)=>assert.rejects(work,e=>e instanceof AppError&&e.status===status);
async function location(order:Order,point=A,accuracy:number|null=15){
  await database().query('UPDATE qadam.courier_locations SET received_at=clock_timestamp()-interval \'6 seconds\',captured_at=clock_timestamp()-interval \'6 seconds\' WHERE order_id=$1',[order.id]);
  await reportLocation(courier,order.id,{...point,accuracy,capturedAt:new Date().toISOString()});
}
async function assigned(){const order=await createOrder(customer,input());return acceptOrder(courier,order.id,true);}
async function code(order:Order,stage:'PICKUP'|'DROPOFF'){
  await issueHandoffCode(customer,order.id,{...fields(order),stage});
  return (await viewHandoffCode(customer,order.id,stage)).code!;
}
async function pickup(order:Order){const value=await code(order,'PICKUP');return confirmHandoff(courier,order.id,{...fields(order),stage:'PICKUP',code:value,handedOver:true});}
before(async()=>{
  await migrate();
  for(const role of ['CUSTOMER','COURIER','COURIER','CUSTOMER'] as const){
    const user=(await database().query("INSERT INTO qadam.users(email,name,role,password_hash) VALUES($1,'Safety fixture',$2,'unused') RETURNING id,email,name,role",[`safety-${randomUUID()}@qadam.invalid`,role])).rows[0];users.push(user);
    await database().query('INSERT INTO qadam.telegram_identities(user_id,telegram_user_id) VALUES($1,$2)',[user.id,String(5800000000000+Math.floor(Math.random()*1e9))]);
  }
  [customer,courier,other,admin]=users;await database().query('INSERT INTO qadam.administrators(user_id) VALUES($1)',[admin.id]);
  // Reproduce a delivery entering custody between schema installation and release.
  await database().query('UPDATE qadam.handoff_enforcement SET activated_at=NULL WHERE singleton');
  const legacy=(await database().query("INSERT INTO qadam.orders(customer_id,courier_id,request_key,pickup_address,destination_address,recipient_name,recipient_phone,status,assignment_version) VALUES($1,$2,$3,'Алматы, Абая 100','Алматы, Самал 111','Получатель','+77000000000','PICKED_UP',1) RETURNING id",[customer.id,courier.id,randomUUID()])).rows[0];
  const pendingPickup=(await database().query("INSERT INTO qadam.orders(customer_id,courier_id,request_key,pickup_address,destination_address,recipient_name,recipient_phone,status,assignment_version,custody_assignment_version,custody_at) VALUES($1,$2,$3,'Алматы, Абая 100','Алматы, Самал 111','Получатель','+77000000000','PICKED_UP',1,1,clock_timestamp()) RETURNING id",[customer.id,courier.id,randomUUID()])).rows[0];
  const oldServer=await database().connect();
  let activation:Promise<{error:unknown}>|undefined;
  try{
    await oldServer.query('BEGIN');await oldServer.query("SET LOCAL lock_timeout='3000ms'");await oldServer.query('SELECT id FROM qadam.orders WHERE id=$1 FOR UPDATE',[legacy.id]);
    activation=ensureHandoffEnforcement().then(()=>({error:null}),error=>({error}));
    let waiting=false;
    for(let i=0;i<100&&!waiting;i++){
      waiting=!!(await database().query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query='LOCK TABLE qadam.orders IN EXCLUSIVE MODE'")).rowCount;
      if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(waiting,true,'Activation waits for the old request to finish');
    await oldServer.query("UPDATE qadam.orders SET status='IN_TRANSIT' WHERE id=$1",[legacy.id]);await oldServer.query('COMMIT');
  }finally{await oldServer.query('ROLLBACK');oldServer.release();}
  const activationResult=await activation;if(activationResult?.error)throw activationResult.error;await ensureHandoffEnforcement();
  const enrolled=(await database().query("SELECT status,custody_assignment_version,(SELECT count(*)::int FROM qadam.order_events WHERE order_id=$1 AND kind='SAFETY_ENROLLED') AS events,(SELECT count(*)::int FROM qadam.order_handoff_proofs WHERE order_id=$1) AS proofs FROM qadam.orders WHERE id=$1",[legacy.id])).rows[0];
  assert.equal(enrolled.status,'IN_TRANSIT');assert.equal(enrolled.custody_assignment_version,1);assert.equal(enrolled.events,1);assert.equal(enrolled.proofs,0);
  const resumed=(await database().query('SELECT status FROM qadam.orders WHERE id=$1',[pendingPickup.id])).rows[0];assert.equal(resumed.status,'IN_TRANSIT');
});
beforeEach(async()=>{process.env.DELIVERY_HANDOFFS_ENABLED='true';process.env.DELIVERY_PROOF_ENABLED='false';await database().query('DELETE FROM qadam.orders WHERE customer_id=$1',[customer.id]);await database().query('UPDATE qadam.pricing_settings SET active=false,config=NULL');await database().query('DELETE FROM qadam.courier_blocks WHERE user_id=ANY($1::uuid[])',[users.map(u=>u.id)]);await readyCourier(courier);await readyCourier(other);});
after(async()=>{await database().query('DELETE FROM qadam.orders WHERE customer_id=$1',[customer.id]);await database().query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])',[users.map(u=>u.id)]);await closeDatabase();});

test('mandatory handoffs cannot be disabled on public origins, Vercel or a non-test DB',()=>{
  assert.equal(handoffsEnabled({}),true);
  assert.equal(handoffsEnabled({DELIVERY_HANDOFFS_ENABLED:'false',APP_ORIGIN:'http://localhost:3100',DATABASE_URL:'postgresql://localhost/qadam_test'}),false);
  for(const change of [{APP_ORIGIN:'https://qadam.example'},{DATABASE_URL:'postgresql://localhost/qadam'},{VERCEL:'1'}])assert.throws(()=>handoffsEnabled({DELIVERY_HANDOFFS_ENABLED:'false',APP_ORIGIN:'http://localhost:3100',DATABASE_URL:'postgresql://localhost/qadam_test',...change}));
});
test('new deliveries require both points; assignments remain possible far from pickup',async()=>{
  await reject(createOrder(customer,{...input(),pickupPoint:null}),422);
  await database().query('UPDATE qadam.courier_presence SET latitude=$2,longitude=$3 WHERE user_id=$1',[courier.id,far.latitude,far.longitude]);
  const order=await assigned();assert.equal(order.status,'ACCEPTED');assert.equal(order.handoffRequired,true);
  await reject(issueHandoffCode(customer,order.id,{...fields(order),stage:'PICKUP'}),409);
  for(const target of ['PICKED_UP','DELIVERED'] as const)await reject(transitionOrder(courier,order.id,target),409);
  await reject(confirmHandoff(courier,order.id,{...fields(order),stage:'PICKUP',code:'123456',handedOver:true}),409);
});
test('database guard blocks writes from retired servers even when their old status code omits verification',async()=>{
  const order=await assigned();
  for(const status of ['PICKED_UP','IN_TRANSIT','DELIVERED'])await assert.rejects(database().query('UPDATE qadam.orders SET status=$2 WHERE id=$1',[order.id,status]),(e:unknown)=>!!e&&typeof e==='object'&&'constraint' in e&&e.constraint==='qadam_handoff_required');
  const transit=await pickup(order);
  await assert.rejects(database().query("UPDATE qadam.orders SET status='DELIVERED' WHERE id=$1",[order.id]),(e:unknown)=>!!e&&typeof e==='object'&&'constraint' in e&&e.constraint==='qadam_handoff_required');
  assert.equal(transit.status,'IN_TRANSIT');
});
test('GPS, separate codes and a single atomic pickup lead to independently confirmed delivery',async()=>{
  let order=await assigned();const first=await code(order,'PICKUP');assert.match(first,/^\d{6}$/);
  for(const actor of [courier,other,admin])await assert.rejects(viewHandoffCode(actor,order.id,'PICKUP'));
  const body={...fields(order),stage:'PICKUP',code:first,handedOver:true};
  const responses=await Promise.all([confirmHandoff(courier,order.id,body),confirmHandoff(courier,order.id,body)]);order=responses[0];assert.equal(order.status,'IN_TRANSIT');
  assert.equal((await database().query('SELECT count(*)::int AS n FROM qadam.order_handoff_proofs WHERE order_id=$1',[order.id])).rows[0].n,1);
  const last=await code(order,'DROPOFF');assert.notEqual(last,first);
  await reject(confirmHandoff(courier,order.id,{...fields(order),stage:'DROPOFF',code:last,handedOver:true}),409);
  await location(order,B);
  await reject(confirmHandoff(courier,order.id,{...fields(order),stage:'DROPOFF',code:first,handedOver:true}),400);
  order=await completeOrder(courier,order.id,{...fields(order),code:last,handedOver:true});assert.equal(order.status,'DELIVERED');
  const proofs=(await database().query('SELECT stage,accuracy,distance_m FROM qadam.order_handoff_proofs WHERE order_id=$1',[order.id])).rows;assert.equal(proofs.length,2);assert.ok(proofs.every(p=>p.distance_m<1));
  assert.equal(order.events.filter(e=>e.kind==='PICKUP_VERIFIED').length,1);assert.equal(order.events.filter(e=>e.kind==='DROPOFF_VERIFIED').length,1);
  assert.ok(!JSON.stringify(order).includes(first));assert.ok(!JSON.stringify(await orderTrustInfo(courier,order.id)).includes(last));
});
test('old completion, boolean confirmations, optional photo flags and generic status cannot bypass safety',async()=>{
  let order=await assigned();await reject(transitionOrder(courier,order.id,'PICKED_UP'),409);order=await pickup(order);
  await reject(transitionOrder(courier,order.id,'DELIVERED'),409);
  await assert.rejects(completeOrder(courier,order.id,{requestKey:randomUUID(),expectedVersion:order.assignmentVersion,handedOver:true}));
  const last=await code(order,'DROPOFF');await reject(completeOrder(courier,order.id,{...fields(order),handedOver:true,code:last}),409);
  assert.equal((await getOrder(customer,order.id)).status,'IN_TRANSIT');
});
test('stale fixes, missing/poor accuracy, future timestamps, stopped consent and offline shifts fail closed',async()=>{
  const order=await assigned(),value=await code(order,'PICKUP');
  const body=()=>({...fields(order),stage:'PICKUP',code:value,handedOver:true});
  for(const sql of ["accuracy=NULL","accuracy=76","received_at=clock_timestamp()-interval '61 seconds'","captured_at=clock_timestamp()-interval '61 seconds'","captured_at=clock_timestamp()+interval '11 seconds'"]){
    await location(order);await database().query(`UPDATE qadam.courier_locations SET ${sql} WHERE order_id=$1`,[order.id]);await reject(confirmHandoff(courier,order.id,body()),409);
  }
  await location(order);await database().query('UPDATE qadam.courier_presence SET sharing=false WHERE user_id=$1',[courier.id]);await reject(confirmHandoff(courier,order.id,body()),409);
  await readyCourier(courier);await database().query('UPDATE qadam.courier_status SET online=false WHERE user_id=$1',[courier.id]);await reject(confirmHandoff(courier,order.id,body()),409);
  assert.equal((await getOrder(customer,order.id)).status,'ACCEPTED');
});
test('wrong attempts persist and retries never spend another attempt; five guesses lock the code',async()=>{
  const order=await assigned(),value=await code(order,'PICKUP'),wrong=value==='000000'?'111111':'000000';
  const body={...fields(order),stage:'PICKUP',code:wrong,handedOver:true};
  await reject(confirmHandoff(courier,order.id,body),400);await reject(confirmHandoff(courier,order.id,body),400);
  assert.equal((await orderTrustInfo(courier,order.id)).handoff?.attemptsRemaining,4);
  for(let i=0;i<4;i++)await reject(confirmHandoff(courier,order.id,{...body,requestKey:randomUUID()}),i===3?423:400);
  await reject(confirmHandoff(courier,order.id,{...body,requestKey:randomUUID(),code:value}),423);
  assert.equal((await getOrder(customer,order.id)).status,'ACCEPTED');
});
test('expired and rotated codes cannot be reused; only the owner or administrator can reset, with a reason and limits',async()=>{
  const order=await assigned(),value=await code(order,'PICKUP');
  await reject(issueHandoffCode(courier,order.id,{...fields(order),stage:'PICKUP',reset:true,reason:'Украденный код'}),403);
  await reject(issueHandoffCode(customer,order.id,{...fields(order),stage:'PICKUP',reset:true,reason:'Повторный выпуск'}),429);
  await database().query("UPDATE qadam.order_handoffs SET issued_at=clock_timestamp()-interval '16 minutes',expires_at=clock_timestamp()-interval '1 minute',reset_at=clock_timestamp()-interval '2 minutes' WHERE order_id=$1",[order.id]);
  await reject(confirmHandoff(courier,order.id,{...fields(order),stage:'PICKUP',code:value,handedOver:true}),410);
  await issueHandoffCode(admin,order.id,{...fields(order),stage:'PICKUP',reset:true,reason:'Клиент потерял код'});
  const next=(await viewHandoffCode(customer,order.id,'PICKUP')).code!;assert.notEqual(next,value);
  await reject(confirmHandoff(courier,order.id,{...fields(order),stage:'PICKUP',code:value,handedOver:true}),400);
});
test('release and reassignment invalidate earlier codes, requests and former courier access',async()=>{
  let order=await assigned();const value=await code(order,'PICKUP'),old={...fields(order),stage:'PICKUP',code:value,handedOver:true};
  await releaseOrder(courier,order.id,{requestKey:randomUUID(),expectedVersion:order.assignmentVersion,reason:'Не успеваю приехать',notPickedUp:true});
  order=await acceptOrder(other,order.id,true);await reject(confirmHandoff(courier,order.id,old),403);
  assert.equal((await viewHandoffCode(customer,order.id,'PICKUP')).code,null);
  await reject(confirmHandoff(other,order.id,{...old,...fields(order)}),409);
  const next=await code(order,'PICKUP');await reject(confirmHandoff(other,order.id,{...fields(order),stage:'PICKUP',code:value,handedOver:true}),400);
  assert.notEqual(next,value);
});
test('a blocked courier cannot confirm; status, code and presence cannot override the block',async()=>{
  const order=await assigned(),value=await code(order,'PICKUP');
  await changeCourierBlock(admin,courier.id,{requestKey:randomUUID(),blocked:true,expectedBlocked:false,reason:'Разбор спорной передачи'});
  await reject(confirmHandoff(courier,order.id,{...fields(order),stage:'PICKUP',code:value,handedOver:true}),403);
});
test('radius is fixed and is never expanded by reported accuracy; Telegram fixes use the same guard',async()=>{
  const order=await assigned();await location(order,{latitude:A.latitude+.002,longitude:A.longitude},75);
  const row=await lockedOrder(database(),order.id);assert.equal((await handoffPresence(database(),row,'PICKUP')).ready,false);
  await location(order,A,75);await database().query("UPDATE qadam.courier_locations SET location_source='TELEGRAM_LIVE' WHERE order_id=$1",[order.id]);
  assert.equal((await handoffPresence(database(),row,'PICKUP')).ready,true);
});
test('route corrections are private, audited and invalidate codes and requests for the previous point',async()=>{
  let order=await assigned();const value=await code(order,'PICKUP');const correction={...fields(order),stage:'PICKUP',reason:'Исправлен вход в здание',point:A,address:order.pickupAddress};
  await reject(correctHandoffPoint(courier,order.id,correction),403);await reject(correctHandoffPoint(customer,order.id,correction),403);
  order=await correctHandoffPoint(admin,order.id,correction);assert.equal(order.routeVersion,1);
  await reject(confirmHandoff(courier,order.id,{...fields(order),expectedRouteVersion:0,stage:'PICKUP',code:value,handedOver:true}),409);
  assert.equal((await viewHandoffCode(customer,order.id,'PICKUP')).code,null);assert.ok(order.events.some(e=>e.kind==='POINT_CORRECTED'));
});
test('owner can restore a missing legacy point, but a courier cannot move it to their location',async()=>{
  let order=await assigned();await database().query('UPDATE qadam.orders SET pickup_latitude=NULL,pickup_longitude=NULL WHERE id=$1',[order.id]);
  await reject(issueHandoffCode(customer,order.id,{...fields(order),stage:'PICKUP'}),409);
  order=await correctHandoffPoint(customer,order.id,{...fields(order),stage:'PICKUP',point:A,address:order.pickupAddress,reason:'Подтверждаю вход на карте'});
  assert.deepEqual(order.pickupPoint,A);assert.equal((await pickup(order)).status,'IN_TRANSIT');
});
test('a replacement after pickup requires an administrator custody decision and invalidates the first courier code',async()=>{
  let order=await pickup(await assigned());const first=await code(order,'DROPOFF');
  const body={requestKey:randomUUID(),expectedVersion:order.assignmentVersion,expectedStatus:order.status,expectedCourierId:courier.id,action:'ASSIGN',courierId:other.id,reason:'Передача согласована с отправителем'};
  await reject(manageOrder(admin,order.id,body),409);
  order=await manageOrder(admin,order.id,{...body,requestKey:randomUUID(),custodyConfirmed:true});
  await reject(confirmHandoff(courier,order.id,{...fields(order),stage:'DROPOFF',code:first,handedOver:true}),403);
  assert.equal((await viewHandoffCode(customer,order.id,'DROPOFF')).code,null);
  const second=await code(order,'DROPOFF');assert.notEqual(second,first);
});
test('dropoff codes expire within 24 hours of pickup and cannot be prolonged by a reset',async()=>{
  const order=await pickup(await assigned());await code(order,'DROPOFF');
  await database().query("UPDATE qadam.orders SET custody_at=clock_timestamp()-interval '25 hours' WHERE id=$1",[order.id]);
  await database().query("UPDATE qadam.order_handoffs SET reset_at=clock_timestamp()-interval '2 minutes' WHERE order_id=$1",[order.id]);
  await reject(issueHandoffCode(customer,order.id,{...fields(order),stage:'DROPOFF',reset:true,reason:'Попытка продлить вручение'}),410);
});
test('handoff APIs enforce session, role, origin, strict input and never expose codes to a courier',async()=>{
  for(const user of users){const token=randomBytes(32).toString('hex');tokens.set(user.id,token);await database().query("INSERT INTO qadam.sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[user.id,createHash('sha256').update(token).digest('hex')]);}
  const order=await assigned(),value=await code(order,'PICKUP'),context={params:Promise.resolve({id:order.id})};
  const body={...fields(order),stage:'PICKUP',code:value,handedOver:true};
  const request=(method:string,actor?:User,input?:unknown,origin=process.env.APP_ORIGIN!)=>new Request(`${process.env.APP_ORIGIN}/api/orders/${order.id}/handoff-code?stage=PICKUP`,{method,headers:{Origin:origin,'Content-Type':'application/json',...(actor?{Authorization:`Bearer ${tokens.get(actor.id)}`}:{})},...(input?{body:JSON.stringify(input)}:{})});
  assert.equal((await codeAPI(request('GET'),context)).status,401);assert.equal((await codeAPI(request('GET',courier),context)).status,403);
  const response=await codeAPI(request('GET',customer),context);assert.equal(response.status,200);assert.equal((await response.json()).code,value);assert.match(response.headers.get('cache-control')!,/no-store/);
  assert.equal((await handoffAPI(request('POST',undefined,body),context)).status,401);
  assert.equal((await handoffAPI(request('POST',courier,body,'https://evil.invalid'),context)).status,403);
  assert.equal((await handoffAPI(request('POST',courier,{...body,latitude:A.latitude}),context)).status,400);
  assert.equal((await issueAPI(request('POST',courier,{...fields(order),stage:'PICKUP'}),context)).status,403);
  assert.equal((await handoffAPI(request('POST',customer,body),context)).status,403);
});
test('public tracking and ordinary responses exclude every handoff secret and private proof field',async()=>{
  const order=await assigned(),value=await code(order,'PICKUP'),link=await recipientLink(customer,order.id,'create');
  const publicData=JSON.stringify(await publicRecipientDelivery(new URL(link.url!).pathname.split('/').pop()!));
  assert.ok(!publicData.includes(value));for(const key of ['encrypted_code','verifier','attemptsRemaining','pickupAddress','recipientPhone','codeVersion'])assert.ok(!publicData.includes(key));
  const actions=JSON.stringify((await database().query('SELECT fingerprint,result FROM qadam.order_actions WHERE order_id=$1',[order.id])).rows);assert.ok(!actions.includes(value));
});
test('required photos cannot be bypassed, and a point change cannot resurrect an upload in flight',async()=>{
  let order=await pickup(await assigned());await database().query('UPDATE qadam.orders SET photo_required=true WHERE id=$1',[order.id]);order=await getOrder(customer,order.id);await location(order,B);const value=await code(order,'DROPOFF');
  await reject(confirmHandoff(courier,order.id,{...fields(order),stage:'DROPOFF',code:value,handedOver:true}),409);
  const jpeg=await sharp({create:{width:80,height:60,channels:3,background:'#b4c6d0'}}).jpeg().toBuffer();process.env.TELEGRAM_STORAGE_CHAT_ID='-1001234567890';
  let release!:()=>void,started!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),began=new Promise<void>(resolve=>{started=resolve;});
  const uploadBody={requestKey:randomUUID(),expectedVersion:order.assignmentVersion,image:jpeg.toString('base64')};
  const pending=uploadOrderPhoto(courier,order.id,uploadBody,{async upload(){started();await gate;return{fileId:'private-fixture',messageId:1,chatId:process.env.TELEGRAM_STORAGE_CHAT_ID!};},async download(){return jpeg;}});
  const rejected=reject(pending,409);await began;
  await correctHandoffPoint(admin,order.id,{...fields(order),stage:'DROPOFF',point:B,address:order.destinationAddress,reason:'Уточнение входа получателя'});release();await rejected;
  await reject(uploadOrderPhoto(courier,order.id,uploadBody),409);
  assert.equal((await orderTrustInfo(courier,order.id)).photo,null);assert.equal((await getOrder(customer,order.id)).status,'IN_TRANSIT');
});
