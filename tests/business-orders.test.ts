import { after,before,beforeEach,test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { database,closeDatabase } from '../src/lib/db';
import { migrate } from '../scripts/migrate';
import { businessProfile,saveBusinessProfile,deleteBusinessProfile,businessProfileSchema } from '../src/lib/business-profiles';
import { createOrder,createOrderSchema,getOrder,listOrders,acceptOrder } from '../src/lib/orders';
import { createQuote,quoteFingerprint,type QuoteInput } from '../src/lib/order-quotes';
import { almatyInput,scheduleError,deliveryWindow,repeatedParcel } from '../src/lib/order-details';
import { alertWaitingOrders } from '../src/lib/order-notifications';
import { deliveryPilot } from '../src/lib/delivery-pilot';
import { saveTelegramContact } from '../src/lib/user-profiles';
import { GET,PUT,DELETE } from '../src/app/api/business-profile/route';
import { AppError } from '../src/lib/errors';
import type { User } from '../src/lib/types';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test')||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('Business tests require a separate local _test database');
process.env.DATABASE_URL=url;process.env.APP_ORIGIN='http://127.0.0.1:3100';
const users:User[]=[],tokens:string[]=[];let customer:User,other:User,courier:User;
const a={latitude:43.24,longitude:76.9},b={latitude:43.25,longitude:76.91};
const profile=()=>({name:'Цветочная «Лепесток»',pickupAddress:'Абая, 100, Алматы',pickupPoint:a,pickupDetails:'Вход со двора'});
const payload=()=>({requestKey:randomUUID(),pickupAddress:'Абая, 100, Алматы',destinationAddress:'Самал-2, 111, Алматы',pickupPoint:a,destinationPoint:b,recipientName:'Приватный получатель',recipientPhone:'+77000000011',notes:'Инструкция по перевозке',parcelType:'FLOWERS' as const,fragile:true,surprise:true,cardText:'Приватная открытка',shareContact:true});
const tomorrow=(offset=1)=>new Date(Date.now()+offset*86400_000+5*3600_000).toISOString().slice(0,10);
const window=(offset=1)=>({deliverAfter:almatyInput(tomorrow(offset),'14:00')!,deliverBefore:almatyInput(tomorrow(offset),'15:00')!});
const denied=(work:Promise<unknown>,status:number)=>assert.rejects(work,e=>e instanceof AppError&&e.status===status);
const request=(method:string,token?:string,body?:unknown,origin='http://127.0.0.1:3100')=>new Request('http://127.0.0.1:3100/api/business-profile',{method,headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
before(async()=>{
  await migrate();
  for(const role of ['CUSTOMER','CUSTOMER','COURIER'] as const){
    const user:User=(await database().query(`INSERT INTO qadam.users(email,name,role,password_hash) VALUES($1,'Business test',$2,'unused-synthetic') RETURNING id,email,name,role`,[`business-${randomUUID()}@qadam.invalid`,role])).rows[0];
    user.telegramId=String(4900000000000+Math.floor(Math.random()*1000000000));users.push(user);
    await database().query('INSERT INTO qadam.telegram_identities(user_id,telegram_user_id,allows_write) VALUES($1,$2,true)',[user.id,user.telegramId]);
    const token=randomBytes(32).toString('hex');tokens.push(token);
    await database().query("INSERT INTO qadam.sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[user.id,createHash('sha256').update(token).digest('hex')]);
  }
  [customer,other,courier]=users;
});
beforeEach(async()=>{
  await database().query('UPDATE qadam.pricing_settings SET active=false,config=NULL');
  await database().query('DELETE FROM qadam.orders WHERE customer_id=ANY($1::uuid[])',[users.map(x=>x.id)]);
  await database().query('DELETE FROM qadam.business_profiles WHERE user_id=ANY($1::uuid[])',[users.map(x=>x.id)]);
  await database().query('DELETE FROM qadam.user_profiles WHERE user_id=ANY($1::uuid[])',[users.map(x=>x.id)]);
  await database().query('DELETE FROM qadam.administrators WHERE user_id=ANY($1::uuid[])',[users.map(x=>x.id)]);
  await saveTelegramContact(customer.telegramId!,'+77000000042',Date.now());
});
after(async()=>{
  await database().query('UPDATE qadam.pricing_settings SET active=false,config=NULL');
  await database().query('DELETE FROM qadam.orders WHERE customer_id=ANY($1::uuid[])',[users.map(x=>x.id)]);
  await database().query('DELETE FROM qadam.telegram_outbox WHERE telegram_user_id=ANY($1::bigint[])',[users.map(x=>x.telegramId)]);
  await database().query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])',[users.map(x=>x.id)]);
  await closeDatabase();
});

test('business API authenticates every method, isolates accounts, validates origin and requires an own verified contact',async()=>{
  assert.equal((await GET(request('GET'))).status,401);
  assert.equal((await PUT(request('PUT',tokens[0],profile(),'https://evil.invalid'))).status,403);
  assert.equal((await PUT(request('PUT',tokens[2],profile()))).status,403);
  assert.equal((await PUT(request('PUT',tokens[1],profile()))).status,409);
  await denied(createOrder(other,payload()),409);
  await denied(createOrder(customer,{...payload(),shareContact:false}),409);
  assert.equal((await PUT(request('PUT',tokens[0],{...profile(),userId:other.id}))).status,400);
  assert.equal((await PUT(request('PUT',tokens[0],profile()))).status,200);
  assert.equal((await (await GET(request('GET',tokens[0]))).json()).profile.name,profile().name);
  assert.deepEqual(await (await GET(request('GET',tokens[1]))).json(),{profile:null});
  assert.equal((await DELETE(request('DELETE',tokens[1],{}))).status,200);
  assert.ok(await businessProfile(customer));
  assert.equal((await DELETE(request('DELETE',tokens[0],{}))).status,200);
  assert.equal(await businessProfile(customer),null);
  assert.equal(businessProfileSchema.safeParse({...profile(),pickupPoint:null}).success,false);
});

test('order snapshots survive profile edits/deletion and retries; private card and contacts open only after assignment',async()=>{
  await saveBusinessProfile(customer,profile());
  const input={...payload(),...window(),businessName:profile().name,pickupDetails:profile().pickupDetails};
  const [order,retry]=await Promise.all([createOrder(customer,input),createOrder(customer,input)]);
  assert.equal(order.id,retry.id);
  assert.equal(order.cardText,input.cardText);
  await saveBusinessProfile(customer,{...profile(),name:'Новое название',pickupAddress:'Достык, 50, Алматы'});
  await deleteBusinessProfile(customer);
  assert.equal((await createOrder(customer,input)).id,order.id);
  const saved=await getOrder(customer,order.id);
  assert.equal(saved.businessName,profile().name);assert.equal(saved.pickupAddress,input.pickupAddress);assert.equal(saved.pickupDetails,input.pickupDetails);
  await denied(createOrder(customer,{...input,cardText:'Другой текст'}),409);
  await denied(createOrder(customer,{...input,urgent:true}),409);
  await denied(createOrder(customer,{...input,...window(2)}),409);
  await denied(createOrder(customer,{...input,requestKey:randomUUID()}),409);
  await denied(getOrder(other,order.id),404);
  const hidden=(await listOrders(courier)).find(x=>x.id===order.id)!;
  assert.equal(hidden.cardText,null);assert.equal(hidden.recipientName,null);assert.equal(hidden.senderPhone,null);
  assert.equal((await getOrder(courier,order.id)).cardText,null);
  const accepted=await acceptOrder(courier,order.id,true);
  assert.equal(accepted.cardText,input.cardText);assert.equal(accepted.recipientPhone,input.recipientPhone);assert.equal(accepted.senderPhone,'+77000000042');
  assert.equal((await acceptOrder(courier,order.id,true)).cardText,input.cardText);
});

test('Almaty input and delivery windows enforce real dates, 30-minute/14-day bounds and same local day',()=>{
  const now=new Date('2026-10-30T07:00:00Z').getTime();
  assert.equal(almatyInput('2026-10-31','14:00'),'2026-10-31T09:00:00.000Z');
  assert.equal(almatyInput('2026-02-30','14:00'),null);assert.equal(almatyInput('2026-10-31','24:10'),null);
  const valid={deliverAfter:'2026-10-31T09:00:00Z',deliverBefore:'2026-10-31T09:30:00Z'};
  assert.equal(scheduleError(valid,now),null);assert.match(deliveryWindow(valid)!,/14:00–14:30/);
  for(const invalid of [{...valid,deliverBefore:null},{...valid,deliverBefore:'2026-10-31T09:29:59Z'},
    {...valid,deliverAfter:'2026-10-30T07:00:00Z'},
    {deliverAfter:'2026-11-13T06:30:00Z',deliverBefore:'2026-11-13T07:00:01Z'},
    {deliverAfter:'2026-10-31T18:30:00Z',deliverBefore:'2026-10-31T19:30:00Z'}])assert.ok(scheduleError(invalid,now));
  assert.equal(scheduleError({deliverAfter:'2026-11-13T06:30:00Z',deliverBefore:'2026-11-13T07:00:00Z'},now),null);
});

test('repeating a legacy order preserves its known type and does not drop old goods or unknown instructions',()=>{
  assert.deepEqual(repeatedParcel({notes:'Тип отправления: Документы\nО посылке: Договор\nКомментарий: Главный вход'}),{kind:'DOCUMENTS',description:'Договор',notes:'Главный вход'});
  const goods=repeatedParcel({notes:'Тип отправления: Товары\nКомментарий: Проверить коробку'});
  assert.equal(goods.kind,'OTHER');assert.match(goods.notes,/Тип отправления: Товары/);assert.match(goods.notes,/Проверить коробку/);
  const unknown=repeatedParcel({notes:'Произвольная историческая инструкция'});
  assert.equal(unknown.kind,'PARCEL');assert.equal(unknown.notes,'Произвольная историческая инструкция');
  assert.equal(repeatedParcel({parcelType:'CAKE',notes:'О посылке: Коробка\nКомментарий: Не переворачивать'}).kind,'CAKE');
});

test('scheduled creation rejects invalid windows and expired acceptance; retries return committed order after time passes',async()=>{
  const valid=window();
  for(const schedule of [{deliverAfter:valid.deliverAfter},
    {...valid,deliverBefore:new Date(new Date(valid.deliverAfter).getTime()+29*60_000).toISOString()},
    window(15),{deliverAfter:almatyInput(tomorrow(-1),'14:00'),deliverBefore:almatyInput(tomorrow(-1),'15:00')}]){
    await denied(createOrder(customer,{...payload(),...schedule}),400);
  }
  const input={...payload(),...valid};const saved=await createOrder(customer,input);
  await database().query('UPDATE qadam.orders SET deliver_after=$2,deliver_before=$3 WHERE id=$1',[saved.id,almatyInput(tomorrow(-1),'14:00'),almatyInput(tomorrow(-1),'15:00')]);
  await denied(acceptOrder(courier,saved.id,true),409);
  // An unmodified retry of a historical window is valid even after the interval expires.
  const old={...input,deliverAfter:almatyInput(tomorrow(-1),'14:00')!,deliverBefore:almatyInput(tomorrow(-1),'15:00')!};
  assert.equal((await createOrder(customer,old)).id,saved.id);
  assert.equal(createOrderSchema.safeParse({...payload(),cardText:'x'.repeat(301)}).success,false);
});

test('current fixed-price mode rejects future dates before provider calls; metadata is bound to a quote',async()=>{
  const tariff={version:'test-business-car',minimumKzt:1200,baseKzt:800,perKmKzt:70,perMinuteKzt:12,roundToKzt:50,ttlSeconds:120,provider:'TOMTOM_V1',zone:{...deliveryPilot.zone}};
  await database().query('UPDATE qadam.pricing_settings SET active=true,config=$1',[JSON.stringify(tariff)]);
  const quote:QuoteInput={...payload(),transport:'CAR',shareContact:true,pilotTermsVersion:deliveryPilot.termsVersion,payer:'SENDER',paymentMethod:'CASH'};
  const {requestKey:_,...withoutKey}=quote as QuoteInput&{requestKey:string};
  let called=false;
  await denied(createQuote(customer,{...withoutKey,...window()},async()=>{called=true;throw new Error('must not call provider');}),422);
  assert.equal(called,false);
  await denied(createOrder(customer,{...payload(),...window()}),422);
  for(const change of [{fragile:false},{cardText:'changed'},{urgent:true},{pickupDetails:'Другой вход'}])assert.notEqual(quoteFingerprint(withoutKey),quoteFingerprint({...withoutKey,...change}));
});

test('courier sorting happens before LIMIT and future orders do not cause early admin alerts or card broadcasts',async()=>{
  await database().query('INSERT INTO qadam.administrators(user_id) VALUES($1)',[other.id]);
  await database().query('INSERT INTO qadam.courier_status(user_id,online,updated_at) VALUES($1,true,now()) ON CONFLICT(user_id) DO UPDATE SET online=true,updated_at=now()',[courier.id]);
  const future=await createOrder(customer,{...payload(),...window()});
  const urgent=await createOrder(customer,{...payload(),urgent:true});
  const normal=await createOrder(customer,payload());
  await database().query(`INSERT INTO qadam.orders(customer_id,request_key,pickup_address,destination_address,recipient_name,recipient_phone,notes,status,deliver_after,deliver_before)
    SELECT $1,gen_random_uuid(),'Отправление теста','Доставка теста','Тест','+77000000000','','SEARCHING_FOR_COURIER',$2,$3 FROM generate_series(1,105)`,[customer.id,window(2).deliverAfter,window(2).deliverBefore]);
  const sorted=(await listOrders(courier)).filter(x=>x.customerId===customer.id);
  assert.ok(sorted.findIndex(x=>x.id===urgent.id)<sorted.findIndex(x=>x.id===normal.id));
  assert.ok(sorted.findIndex(x=>x.id===normal.id)<sorted.findIndex(x=>x.id===future.id));
  const messages=(await database().query('SELECT body FROM qadam.telegram_outbox WHERE order_id=$1',[future.id])).rows;
  assert.ok(messages.length>0);assert.ok(!JSON.stringify(messages).includes(payload().cardText));assert.match(JSON.stringify(messages),/Ко времени/);
  await database().query("UPDATE qadam.orders SET created_at=now()-interval '1 day' WHERE id=$1",[future.id]);
  await alertWaitingOrders();
  assert.equal((await database().query('SELECT alerted_at FROM qadam.orders WHERE id=$1',[future.id])).rows[0].alerted_at,null);
});
