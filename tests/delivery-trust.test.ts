import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {database,closeDatabase} from '../src/lib/db';
import {migrate} from '../scripts/migrate';
import {AppError} from '../src/lib/errors';
import type {Order,User} from '../src/lib/types';
import {createOrder,acceptOrder,transitionOrder,getOrder,listOrders} from '../src/lib/orders';
import {completeOrder,normalisePhoto,uploadOrderPhoto,readOrderPhoto,expireOrderPhotos} from '../src/lib/order-proof';
import {viewCode,resetCode} from '../src/lib/order-codes';
import {manageOrder,managementInfo,releaseOrder} from '../src/lib/order-management';
import {changeCourierBlock} from '../src/lib/courier-blocks';
import {orderTrustInfo} from '../src/lib/trust-info';
import {rateOrder} from '../src/lib/order-ratings';
import {saveTelegramContact} from '../src/lib/user-profiles';
import {getSession} from '../src/lib/auth';
import {getCourierStatus,setCourierStatus} from '../src/lib/courier-status';
import {readyCourier} from './courier-ready-fixture';
import {updateCourierPresence,nearbyCouriers} from '../src/lib/courier-presence';
import {reportLocation} from '../src/lib/locations';
import {orderRoute} from '../src/lib/routing';
import {shouldSendOrderJob} from '../src/lib/order-notifications';
import {telegramPhotoStorage,type PhotoStorage} from '../src/lib/telegram-storage';
import {POST as completeAPI} from '../src/app/api/orders/[id]/complete/route';
import {GET as codeAPI} from '../src/app/api/orders/[id]/code/route';
import {POST as ratingAPI} from '../src/app/api/orders/[id]/rating/route';
import {GET as trustAPI} from '../src/app/api/orders/[id]/trust/route';
import {testBotToken} from './telegram-fixture';
import {createQuote} from '../src/lib/order-quotes';
import {deliveryPilot} from '../src/lib/delivery-pilot';

const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test')||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('Delivery trust tests require a separate local _test database');
process.env.DATABASE_URL=url;process.env.APP_ORIGIN='http://127.0.0.1:3100';process.env.TELEGRAM_WORKER_ENABLED='false';
process.env.TELEGRAM_BOT_TOKEN=testBotToken;process.env.DELIVERY_CODE_SECRET=randomBytes(32).toString('hex');process.env.TELEGRAM_STORAGE_CHAT_ID='-1001234567890';
const users:User[]=[],tokens:string[]=[];let customer:User,other:User,courier:User,replacement:User,admin:User,jpeg:Buffer,uploadCount=0;
const storage:PhotoStorage={async upload(){uploadCount++;return{fileId:`synthetic-private-photo-${uploadCount}`,messageId:uploadCount,chatId:process.env.TELEGRAM_STORAGE_CHAT_ID!};},async download(){return jpeg;}};
const reject=(work:Promise<unknown>,status:number)=>assert.rejects(work,e=>e instanceof AppError&&e.status===status);
const input=()=>({requestKey:randomUUID(),pickupAddress:'Алматы, Абая 100',destinationAddress:'Алматы, Самал 111',pickupPoint:{latitude:43.24,longitude:76.9},destinationPoint:{latitude:43.25,longitude:76.91},recipientName:'Закрытый получатель',recipientPhone:'+77000000011',notes:'Упаковка',shareContact:true});
const action=(order:Order)=>({requestKey:randomUUID(),expectedVersion:order.assignmentVersion??0});
const handoff=(order:Order,code?:string)=>({...action(order),handedOver:true,...(code?{code}:{})});
const upload=(order:Order,requestKey=randomUUID(),provider=storage)=>uploadOrderPhoto(courier,order.id,{requestKey,expectedVersion:order.assignmentVersion??0,image:jpeg.toString('base64')},provider);
const context=(id:string)=>({params:Promise.resolve({id})});
const request=(method:string,token?:string,body?:unknown,origin=process.env.APP_ORIGIN!)=>new Request(`${process.env.APP_ORIGIN}/api/orders`,{method,headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function inTransit(codeRequired=false){
  const order=await createOrder(customer,{...input(),codeRequired});await acceptOrder(courier,order.id,true);await transitionOrder(courier,order.id,'PICKED_UP');return transitionOrder(courier,order.id,'IN_TRANSIT');
}
before(async()=>{
  await migrate();jpeg=await sharp({create:{width:80,height:60,channels:3,background:'#b4c6d0'}}).jpeg().withMetadata({orientation:1}).toBuffer();
  for(const [index,role] of (['CUSTOMER','CUSTOMER','COURIER','COURIER','CUSTOMER'] as const).entries()){
    const user:User=(await database().query("INSERT INTO qadam.users(email,name,role,password_hash) VALUES($1,$2,$3,'unused-synthetic') RETURNING id,email,name,role",[`trust-${randomUUID()}@qadam.invalid`,`Trust fixture ${index}`,role])).rows[0];
    user.telegramId=String(5300000000000+Math.floor(Math.random()*1000000000));users.push(user);
    await database().query('INSERT INTO qadam.telegram_identities(user_id,telegram_user_id,allows_write) VALUES($1,$2,true)',[user.id,user.telegramId]);
    const token=randomBytes(32).toString('hex');tokens.push(token);await database().query("INSERT INTO qadam.sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[user.id,createHash('sha256').update(token).digest('hex')]);
    await saveTelegramContact(user.telegramId!,`+7700000000${index}`,Date.now());
  }
  [customer,other,courier,replacement,admin]=users;
  await database().query('INSERT INTO qadam.administrators(user_id) VALUES($1)',[admin.id]);
});
beforeEach(async()=>{
  process.env.DELIVERY_PROOF_ENABLED='true';uploadCount=0;
  await database().query('UPDATE qadam.pricing_settings SET active=false,config=NULL');
  await database().query('DELETE FROM qadam.orders WHERE customer_id=ANY($1::uuid[])',[users.map(u=>u.id)]);
  await database().query('DELETE FROM qadam.courier_blocks WHERE user_id=ANY($1::uuid[])',[users.map(u=>u.id)]);
  await database().query('DELETE FROM qadam.courier_presence WHERE user_id=ANY($1::uuid[])',[users.map(u=>u.id)]);
  await database().query('DELETE FROM qadam.courier_status WHERE user_id=ANY($1::uuid[])',[users.map(u=>u.id)]);
  await database().query('DELETE FROM qadam.courier_applications WHERE user_id=ANY($1::uuid[])',[users.map(u=>u.id)]);
  await database().query('DELETE FROM qadam.telegram_outbox WHERE telegram_user_id=ANY($1::bigint[])',[users.map(u=>u.telegramId)]);
  await readyCourier(courier);await readyCourier(replacement);
});
after(async()=>{
  await database().query('DELETE FROM qadam.courier_block_events WHERE user_id=ANY($1::uuid[]) OR actor_id=ANY($1::uuid[])',[users.map(u=>u.id)]);
  await database().query('UPDATE qadam.pricing_settings SET active=false,config=NULL');
  await database().query('DELETE FROM qadam.orders WHERE customer_id=ANY($1::uuid[])',[users.map(u=>u.id)]);
  await database().query('DELETE FROM qadam.telegram_outbox WHERE telegram_user_id=ANY($1::bigint[])',[users.map(u=>u.telegramId)]);
  await database().query('DELETE FROM qadam.courier_applications WHERE user_id=ANY($1::uuid[])',[users.map(u=>u.id)]);
  await database().query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])',[users.map(u=>u.id)]);await closeDatabase();
});

test('new proof requirements are snapshotted; legacy orders and committed retries keep their original requirements',async()=>{
  process.env.DELIVERY_PROOF_ENABLED='false';const legacyInput=input(),legacy=await createOrder(customer,legacyInput);
  assert.equal(legacy.photoRequired,false);assert.equal(legacy.codeRequired,false);
  await reject(createOrder(customer,{...input(),codeRequired:true}),409);
  process.env.DELIVERY_PROOF_ENABLED='true';assert.equal((await createOrder(customer,legacyInput)).photoRequired,false);
  await acceptOrder(courier,legacy.id);await transitionOrder(courier,legacy.id,'PICKED_UP');await transitionOrder(courier,legacy.id,'IN_TRANSIT');
  assert.equal((await transitionOrder(courier,legacy.id,'DELIVERED')).status,'DELIVERED');
  const currentInput={...input(),codeRequired:true},current=await createOrder(customer,currentInput);
  assert.equal(current.photoRequired,true);assert.equal(current.codeRequired,true);
  await reject(createOrder(customer,{...currentInput,codeRequired:false}),409);
  const code=await viewCode(customer,current.id);assert.match(code.code,/^\d{4}$/);
  const stored=(await database().query('SELECT verifier,encrypted_code FROM qadam.order_delivery_codes WHERE order_id=$1',[current.id])).rows[0];
  assert.notEqual(stored.verifier,createHash('sha256').update(code.code).digest('hex'));assert.notEqual(Buffer.from(stored.encrypted_code,'base64').toString(),code.code);
  assert.ok(!JSON.stringify(await getOrder(customer,current.id)).includes('encrypted_code'));
  await reject(viewCode(admin,current.id),403);await reject(viewCode(courier,current.id),404);await reject(viewCode(other,current.id),404);
});

test('photo validation strips metadata and rejects malformed, oversized and excessively large images',async()=>{
  assert.ok((await sharp(jpeg).metadata()).exif);
  const image=await normalisePhoto(jpeg),metadata=await sharp(image.bytes).metadata();assert.equal(metadata.exif,undefined);assert.equal(metadata.format,'jpeg');assert.equal(image.width,80);
  await reject(normalisePhoto(Buffer.alloc(1048577)),413);await reject(normalisePhoto(Buffer.from('<svg>not a photo</svg>')),400);
  await reject(normalisePhoto(Buffer.from([255,216,255,0,0,0,0,0])),400);
  const excessive=await sharp({create:{width:2000,height:2000,channels:3,background:'#fff'}}).png().toBuffer();await reject(normalisePhoto(excessive),400);
});

test('saved photos are idempotent, private and required for completion through every status API',async()=>{
  const order=await inTransit();await reject(transitionOrder(courier,order.id,'DELIVERED'),409);await reject(completeOrder(courier,order.id,handoff(order)),409);
  const key=randomUUID();await upload(order,key);await upload(order,key);assert.equal(uploadCount,1);
  const info=await orderTrustInfo(customer,order.id);assert.equal(info.photo?.state,'READY');assert.ok(!JSON.stringify(info).includes('synthetic-private-photo'));
  assert.ok((await readOrderPhoto(customer,order.id,storage)).length);assert.ok((await readOrderPhoto(admin,order.id,storage)).length);
  await reject(readOrderPhoto(other,order.id,storage),404);await reject(readOrderPhoto(replacement,order.id,storage),404);
  const body=handoff(order);const completed=await Promise.all([completeOrder(courier,order.id,body),completeOrder(courier,order.id,body)]);assert.ok(completed.every(o=>o.status==='DELIVERED'));
  assert.equal((await database().query("SELECT count(*)::int AS n FROM qadam.order_events WHERE order_id=$1 AND status='DELIVERED'",[order.id])).rows[0].n,1);
  assert.equal((await database().query("SELECT count(*)::int AS n FROM qadam.telegram_outbox WHERE order_id=$1 AND method='sendPhoto'",[order.id])).rows[0].n,1);
});

test('wrong code attempts commit once per request, lock at five and reset with owner/admin audit and rate limits',async()=>{
  const order=await inTransit(true);await upload(order);const original=(await viewCode(customer,order.id)).code,wrong=original==='0000'?'0001':'0000';
  const failed=handoff(order,wrong);await reject(completeOrder(courier,order.id,failed),400);await reject(completeOrder(courier,order.id,failed),400);
  assert.equal((await orderTrustInfo(customer,order.id)).attemptsRemaining,4);
  const second=handoff(order,wrong);await Promise.all([reject(completeOrder(courier,order.id,second),400),reject(completeOrder(courier,order.id,second),400)]);
  assert.equal((await orderTrustInfo(customer,order.id)).attemptsRemaining,3);
  for(let remaining=2;remaining>=0;remaining--)await reject(completeOrder(courier,order.id,handoff(order,wrong)),remaining===0?423:400);
  await reject(completeOrder(courier,order.id,handoff(order,original)),423);
  await reject(resetCode(courier,order.id,{...action(order),reason:'Нет доступа'}),403);
  const reset={...action(order),reason:'Получатель потерял код'};await resetCode(customer,order.id,reset);await resetCode(customer,order.id,reset);
  const next=(await viewCode(customer,order.id)).code;assert.notEqual(next,original);assert.equal((await orderTrustInfo(courier,order.id)).attemptsRemaining,5);
  await reject(resetCode(admin,order.id,{...action(order),reason:'Повторный запрос'}),429);
  await reject(completeOrder(courier,order.id,handoff(order,original)),400);
  assert.equal((await completeOrder(courier,order.id,handoff(order,next))).status,'DELIVERED');await reject(viewCode(customer,order.id),409);
});

test('upload failure is safe, retries do not mark delivery complete and a new hour permits retrying an old failed upload',async()=>{
  const order=await inTransit(),key=randomUUID();let calls=0;
  const failing:PhotoStorage={...storage,async upload(){calls++;throw new Error('private-provider-details');}};
  await assert.rejects(upload(order,key,failing),e=>e instanceof AppError&&e.status===503&&!e.message.includes('private-provider-details'));
  assert.equal((await getOrder(customer,order.id)).status,'IN_TRANSIT');await reject(completeOrder(courier,order.id,handoff(order)),409);
  await database().query("UPDATE qadam.order_photos SET upload_attempts=12,lease_until=clock_timestamp()-interval '2 hours' WHERE order_id=$1",[order.id]);
  await upload(order,key);assert.equal(calls,1);assert.equal(uploadCount,1);
  assert.equal((await database().query('SELECT upload_attempts FROM qadam.order_photos WHERE order_id=$1',[order.id])).rows[0].upload_attempts,1);
});

test('release clears contacts and GPS, rotates the code and starts a new notification generation',async()=>{
  await setCourierStatus(courier,{online:true});await setCourierStatus(replacement,{online:true});
  const created=await createOrder(customer,{...input(),codeRequired:true}),oldCode=(await viewCode(customer,created.id)).code;
  // The previous deployed application uses this three-column conflict target.
  await database().query(`INSERT INTO qadam.order_notifications(order_id,user_id,chat_id)
    SELECT order_id,user_id,chat_id FROM qadam.order_notifications WHERE order_id=$1
    ON CONFLICT(order_id,user_id,kind) DO NOTHING`,[created.id]);
  const accepted=await acceptOrder(courier,created.id,true);assert.equal(accepted.recipientName,'Закрытый получатель');
  const reason='Не успеваю к месту забора',body={...action(accepted),reason,notPickedUp:true};
  const released=await releaseOrder(courier,accepted.id,body);await releaseOrder(courier,accepted.id,body);
  assert.equal(released.status,'SEARCHING_FOR_COURIER');assert.equal(released.courierId,null);assert.equal(released.recipientPhone,null);assert.equal(released.senderPhone,null);
  assert.equal((await database().query('SELECT 1 FROM qadam.courier_locations WHERE order_id=$1',[accepted.id])).rowCount,0);
  assert.notEqual((await viewCode(customer,created.id)).code,oldCode);
  assert.equal((await database().query("SELECT count(*)::int AS n FROM qadam.order_events WHERE order_id=$1 AND kind='RELEASE'",[created.id])).rows[0].n,1);
  const notices=(await database().query('SELECT generation,closed_at FROM qadam.order_notifications WHERE order_id=$1 AND user_id=$2 ORDER BY generation',[created.id,replacement.id])).rows;
  assert.equal(notices.length,2);assert.ok(notices[0].closed_at);assert.equal(notices[1].closed_at,null);
  await acceptOrder(replacement,created.id,true);await reject(getOrder(courier,created.id),404);await reject(readOrderPhoto(courier,created.id,storage),404);
  assert.ok((await getOrder(customer,created.id)).events.some(e=>e.kind==='RELEASE'&&e.reason===reason));
});

test('admin assignment uses optimistic preconditions and requires custody confirmation after pickup',async()=>{
  const order=await inTransit(true);await upload(order);const original=(await viewCode(customer,order.id)).code;
  await reject(releaseOrder(courier,order.id,{...action(order),reason:'Уже в пути',notPickedUp:true}),409);
  const body={...action(order),expectedStatus:order.status,expectedCourierId:courier.id,action:'ASSIGN',courierId:replacement.id,reason:'Передача другому исполнителю'};
  await reject(manageOrder(other,order.id,{...body,custodyConfirmed:true}),403);await reject(manageOrder(admin,order.id,body),409);
  const updated=await manageOrder(admin,order.id,{...body,custodyConfirmed:true});assert.equal(updated.status,'IN_TRANSIT');assert.equal(updated.courierId,replacement.id);
  assert.notEqual((await viewCode(customer,order.id)).code,original);await reject(readOrderPhoto(courier,order.id,storage),404);assert.equal((await orderTrustInfo(customer,order.id)).photo,null);
  await reject(manageOrder(admin,order.id,{...body,requestKey:randomUUID(),custodyConfirmed:true}),409);
  assert.ok(!(await managementInfo(admin,order.id)).candidates.some(c=>[customer.id,replacement.id].includes(c.id)));
  await reject(completeOrder(replacement,order.id,handoff(updated,(await viewCode(customer,order.id)).code)),409);
  const cancel={...action(updated),expectedStatus:updated.status,expectedCourierId:replacement.id,action:'CANCEL',reason:'Согласован возврат отправителю',custodyConfirmed:true};
  assert.equal((await manageOrder(admin,order.id,cancel)).status,'CANCELLED');
});

test('blocking stops stale courier sessions, maps, acceptance, GPS and completion while preserving customer access',async()=>{
  await setCourierStatus(courier,{online:true});await updateCourierPresence(courier,{sharing:true,consent:true});
  const fix={latitude:43.181123,longitude:76.795678,accuracy:15,capturedAt:new Date().toISOString()};await updateCourierPresence(courier,fix);
  const order=await inTransit(),before=(await nearbyCouriers(customer)).filter(p=>Math.abs(p.latitude-fix.latitude)<.002);assert.equal(before.length,0); // Busy couriers are already hidden.
  const block={requestKey:randomUUID(),expectedBlocked:false,blocked:true,reason:'Проверка доступа командой'};
  await changeCourierBlock(admin,courier.id,block);await changeCourierBlock(admin,courier.id,block);
  const session=await getSession(tokens[2]);assert.equal(session?.role,'CUSTOMER');assert.equal(session?.courierBlocked,true);
  for(const work of [()=>listOrders(courier),()=>getOrder(courier,order.id),()=>getCourierStatus(courier),()=>setCourierStatus(courier,{online:true}),()=>updateCourierPresence(courier,fix),()=>reportLocation(courier,order.id,fix),()=>orderRoute(courier,order.id),()=>completeOrder(courier,order.id,handoff(order))])await reject(work(),403);
  assert.equal((await getOrder(customer,order.id)).courierId,courier.id);assert.equal((await getOrder(customer,order.id)).status,'IN_TRANSIT');
  const personal=await createOrder(session!,input());assert.equal(personal.customerId,courier.id);
  const row=(await database().query('SELECT s.online,p.sharing,p.latitude FROM qadam.courier_status s JOIN qadam.courier_presence p USING(user_id) WHERE s.user_id=$1',[courier.id])).rows[0];assert.equal(row.online,false);assert.equal(row.sharing,false);assert.equal(row.latitude,null);
  const open=await createOrder(customer,input());await reject(acceptOrder(courier,open.id),403);
  await changeCourierBlock(admin,courier.id,{requestKey:randomUUID(),expectedBlocked:true,blocked:false,reason:'Доступ восстановлен командой'});
  assert.equal((await getSession(tokens[2]))?.role,'COURIER');assert.equal((await getCourierStatus(courier)).online,false);
});

test('ratings are once per delivered order and visible only to the author and administrator',async()=>{
  const order=await inTransit();await reject(rateOrder(customer,order.id,{score:5,comment:'Спасибо'}),409);
  await upload(order);await completeOrder(courier,order.id,handoff(order));
  await reject(rateOrder(other,order.id,{score:5,comment:''}),403);
  const review={score:5,comment:'Посылка доставлена бережно'};await rateOrder(customer,order.id,review);await rateOrder(customer,order.id,review);
  await reject(rateOrder(customer,order.id,{score:4,comment:''}),409);await reject(rateOrder(customer,order.id,{score:0,comment:''}),400);
  assert.equal((await orderTrustInfo(customer,order.id)).rating?.comment,review.comment);assert.equal((await orderTrustInfo(admin,order.id)).rating?.score,5);
  assert.equal(Object.hasOwn(await orderTrustInfo(courier,order.id),'rating'),false);assert.ok(!JSON.stringify(await getOrder(courier,order.id)).includes(review.comment));
});

test('photo access and delayed bot messages expire after 30 days; stored file references are cleared',async()=>{
  const order=await inTransit();await upload(order);await completeOrder(courier,order.id,handoff(order));
  const row=(await database().query("SELECT id::text,telegram_user_id::text AS \"telegramId\",method,body,attempts,order_id AS \"orderId\",order_notification_id AS \"notificationId\" FROM qadam.telegram_outbox WHERE order_id=$1 AND method='sendPhoto'",[order.id])).rows[0];
  assert.equal(await shouldSendOrderJob(row),true);
  await reject(readOrderPhoto(customer,order.id,{...storage,async download(){
    await database().query('UPDATE qadam.order_photos SET expires_at=$2 WHERE order_id=$1',[order.id,new Date(Date.now()-60000)]);return jpeg;
  }}),410);
  await reject(readOrderPhoto(customer,order.id,storage),410);assert.equal(await shouldSendOrderJob(row),false);
  assert.equal(await expireOrderPhotos(),1);assert.equal((await database().query('SELECT file_id FROM qadam.order_photos WHERE order_id=$1',[order.id])).rows[0].file_id,null);
  assert.equal((await orderTrustInfo(customer,order.id)).photo?.state,'EXPIRED');
});

test('trust APIs require authentication and exact mutation origin and never expose a code to admins or other users',async()=>{
  const order=await inTransit(true);
  assert.equal((await codeAPI(request('GET'),context(order.id))).status,401);
  assert.equal((await codeAPI(request('GET',tokens[4]),context(order.id))).status,403);
  assert.equal((await trustAPI(request('GET',tokens[1]),context(order.id))).status,404);
  assert.equal((await completeAPI(request('POST',tokens[2],handoff(order),'https://evil.invalid'),context(order.id))).status,403);
  assert.equal((await ratingAPI(request('POST',tokens[0],{score:5,comment:'',authorId:other.id}),context(order.id))).status,400);
  const own=await codeAPI(request('GET',tokens[0]),context(order.id));assert.equal(own.status,200);assert.match((await own.json()).code,/^\d{4}$/);assert.match(own.headers.get('cache-control')??'',/no-store/);
});

test('Telegram storage accepts the approved month setting and hides provider credentials and paths',async()=>{
  const original=globalThis.fetch;let days=31;const calls:string[]=[];
  globalThis.fetch=async(input)=>{const target=String(input);calls.push(target);if(target.endsWith('/getChat'))return Response.json({ok:true,result:{id:process.env.TELEGRAM_STORAGE_CHAT_ID,type:'channel',message_auto_delete_time:days*86400}});
    if(target.endsWith('/sendPhoto'))return Response.json({ok:true,result:{message_id:123,chat:{id:process.env.TELEGRAM_STORAGE_CHAT_ID},photo:[{file_id:'synthetic-file'}]}});
    throw new Error(`do not expose ${testBotToken}`);};
  try{assert.equal((await telegramPhotoStorage.upload(jpeg,'42')).fileId,'synthetic-file');days=0;await reject(telegramPhotoStorage.upload(jpeg,'42'),503);
    await assert.rejects(telegramPhotoStorage.download('synthetic-file'),e=>e instanceof AppError&&!e.message.includes(testBotToken));assert.ok(calls.every(c=>new URL(c).hostname==='api.telegram.org'));
  }finally{globalThis.fetch=original;}
});

test('code reset is limited to three per hour across owner and administrator',async()=>{
  const order=await createOrder(customer,{...input(),codeRequired:true});let last:Record<string,unknown>={};
  for(let i=0;i<3;i++){
    last={...action(order),reason:'Получатель запросил новый код'};await resetCode(i===1?admin:customer,order.id,last);
    await database().query("UPDATE qadam.order_delivery_codes SET reset_at=clock_timestamp()-interval '61 seconds' WHERE order_id=$1",[order.id]);
  }
  await resetCode(customer,order.id,last);await reject(resetCode(admin,order.id,{...action(order),reason:'Четвёртый перевыпуск за час'}),429);
  await database().query("UPDATE qadam.order_delivery_codes SET reset_window_start=clock_timestamp()-interval '2 hours' WHERE order_id=$1",[order.id]);
  await resetCode(admin,order.id,{...action(order),reason:'Новое окно перевыпуска кода'});
});

test('concurrent dispatcher changes commit only one action for the expected assignment',async()=>{
  const created=await createOrder(customer,input()),order=await acceptOrder(courier,created.id);
  const common={expectedVersion:order.assignmentVersion,expectedStatus:order.status,expectedCourierId:courier.id,reason:'Согласованное действие команды'};
  const results=await Promise.allSettled([
    manageOrder(admin,order.id,{...common,requestKey:randomUUID(),action:'ASSIGN',courierId:replacement.id}),
    manageOrder(admin,order.id,{...common,requestKey:randomUUID(),action:'CANCEL'}),
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const failed=results.find(r=>r.status==='rejected');assert.ok(failed?.status==='rejected'&&failed.reason instanceof AppError&&failed.reason.status===409);
  assert.equal((await database().query("SELECT count(*)::int AS n FROM qadam.order_events WHERE order_id=$1 AND kind IN ('ASSIGN','CANCEL')",[order.id])).rows[0].n,1);
});

test('a pending photo upload cannot overlap another upload or survive courier reassignment',async()=>{
  const order=await inTransit();let signal!:()=>void,finish!:(value:Awaited<ReturnType<PhotoStorage['upload']>>)=>void;
  const started=new Promise<void>(resolve=>{signal=resolve;}),pending=new Promise<Awaited<ReturnType<PhotoStorage['upload']>>>(resolve=>{finish=resolve;});
  const waiting=upload(order,randomUUID(),{...storage,async upload(){signal();return pending;}});const rejected=reject(waiting,409);
  await started;await reject(upload(order),409);
  await manageOrder(admin,order.id,{...action(order),expectedStatus:order.status,expectedCourierId:courier.id,action:'ASSIGN',courierId:replacement.id,reason:'Передача во время загрузки',custodyConfirmed:true});
  finish({fileId:'synthetic-retired-file',messageId:99,chatId:process.env.TELEGRAM_STORAGE_CHAT_ID!});await rejected;
  assert.equal((await orderTrustInfo(customer,order.id)).photo,null);await reject(readOrderPhoto(courier,order.id,storage),404);
});

test('dispatcher assignment preserves priced-order transport, verified phone, exclusive workload and saved price',async()=>{
  const legacy=await createOrder(customer,input());
  for(const [person,transport] of [[courier,'CAR'],[replacement,'FOOT']] as const)await database().query("INSERT INTO qadam.courier_applications(user_id,phone,transport,status,reviewed_at,reviewed_by) VALUES($1,'+77000000000',$2,'APPROVED',now(),$3)",[person.id,transport,admin.id]);
  const tariff={version:'trust-test-car',minimumKzt:1200,baseKzt:800,perKmKzt:70,perMinuteKzt:12,roundToKzt:50,ttlSeconds:120,provider:'TOMTOM_V1',zone:deliveryPilot.zone};
  await database().query('UPDATE qadam.pricing_settings SET active=true,config=$1',[JSON.stringify(tariff)]);
  const {requestKey,...quoteData}=input();
  const data={...quoteData,transport:'CAR' as const,shareContact:true as const,payer:'SENDER' as const,paymentMethod:'CASH' as const,pilotTermsVersion:deliveryPilot.termsVersion};
  const quote=await createQuote(customer,data,async()=>({distanceM:4500,durationS:1200,provider:'TOMTOM_V1',measuredAt:new Date(),paths:[[[43.24,76.9],[43.25,76.91]]]}));
  const order=await createOrder(customer,{...data,requestKey,quoteId:quote.id});
  const body={...action(order),expectedStatus:order.status,expectedCourierId:null,action:'ASSIGN',reason:'Назначение автокурьера'};
  await reject(manageOrder(admin,order.id,{...body,courierId:replacement.id}),409);
  const savedPhone=(await database().query('DELETE FROM qadam.user_profiles WHERE user_id=$1 RETURNING phone',[courier.id])).rows[0].phone;
  await reject(manageOrder(admin,order.id,{...body,courierId:courier.id}),409);
  await saveTelegramContact(courier.telegramId!,savedPhone,Date.now()+1);
  const occupied=await acceptOrder(courier,legacy.id);await reject(manageOrder(admin,order.id,{...body,courierId:courier.id}),409);
  await manageOrder(admin,legacy.id,{...action(occupied),expectedStatus:occupied.status,expectedCourierId:courier.id,action:'CANCEL',reason:'Согласован возврат до забора'});
  const assigned=await manageOrder(admin,order.id,{...body,courierId:courier.id});assert.equal(assigned.pricing?.priceKzt,order.pricing?.priceKzt);assert.equal(assigned.pricing?.platformFeeKzt,0);
});

test('new tables have RLS and no API-role grants; restricted server role can perform only its intended table operations',async()=>{
  const tables=['courier_blocks','courier_block_events','order_delivery_codes','order_actions','order_photos','order_ratings'];
  const client=await database().connect();
  try{
    await client.query('BEGIN');
    if(!(await client.query("SELECT 1 FROM pg_roles WHERE rolname='qadam_app'")).rowCount)await client.query('CREATE ROLE qadam_app NOLOGIN');
    await client.query('GRANT USAGE ON SCHEMA qadam TO qadam_app');
    for(const table of tables)await client.query(`DROP POLICY IF EXISTS ${table}_server ON qadam.${table}`);
    await client.query('DROP POLICY IF EXISTS courier_locations_server_delete ON qadam.courier_locations');
    const migration=await readFile('db/migrations/20261031102814_delivery_trust.sql','utf8');await client.query(migration.slice(migration.lastIndexOf('DO $$')));
    const rls=await client.query("SELECT relname,relrowsecurity FROM pg_class WHERE relnamespace='qadam'::regnamespace AND relname=ANY($1::text[])",[tables]);assert.ok(rls.rows.length===6&&rls.rows.every(r=>r.relrowsecurity));
    for(const role of ['anon','authenticated','service_role'])if((await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount)for(const table of tables)assert.equal((await client.query('SELECT has_table_privilege($1,$2,$3) AS allowed',[role,`qadam.${table}`,'SELECT'])).rows[0].allowed,false);
    await client.query('SET LOCAL ROLE qadam_app');
    for(const table of tables)await client.query(`SELECT 1 FROM qadam.${table} LIMIT 0`);
    await client.query('UPDATE qadam.courier_blocks SET blocked=blocked WHERE false');await client.query('UPDATE qadam.order_photos SET state=state WHERE false');await client.query('UPDATE qadam.order_delivery_codes SET attempts=attempts WHERE false');await client.query('DELETE FROM qadam.courier_locations WHERE false');
  }finally{await client.query('ROLLBACK');client.release();}
});
