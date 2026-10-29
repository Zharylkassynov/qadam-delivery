import { after,before,beforeEach,mock,test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { calculatePrice,type Tariff } from '../src/lib/pricing';
import { closeDatabase,database } from '../src/lib/db';
import { migrate } from '../scripts/migrate';
import { createQuote,quoteFingerprint,type QuoteInput } from '../src/lib/order-quotes';
import { createOrder,acceptOrder,listOrders,getOrder,createOrderSchema } from '../src/lib/orders';
import { quoteRoute } from '../src/lib/quote-routing';
import { phoneProfile,saveTelegramContact } from '../src/lib/user-profiles';
import { receiveTelegramUpdate,processTelegramJobs } from '../src/lib/telegram-bot';
import { AppError } from '../src/lib/errors';
import type { User } from '../src/lib/types';

const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Pricing tests require an isolated _test database');
process.env.DATABASE_URL=url;
// Synthetic tariff: these amounts are test data, not an enabled business policy.
const tariff:Tariff={version:'test-only-car',minimumKzt:1200,baseKzt:800,perKmKzt:70,perMinuteKzt:12,roundToKzt:50,ttlSeconds:300,provider:'TOMTOM_V1',zone:{south:43,north:43.5,west:76.7,east:77.1}};
const a={latitude:43.263,longitude:76.953},b={latitude:43.234,longitude:76.957};
const input=():QuoteInput=>({pickupAddress:'Тест: Зелёный базар',destinationAddress:'Тест: Dostyk Plaza',recipientName:'Синтетический получатель',recipientPhone:'+77000000000',notes:'Не настоящая доставка',pickupPoint:a,destinationPoint:b,transport:'CAR',shareContact:true,payer:'RECIPIENT',paymentMethod:'CASH'});
const metrics=async()=>({distanceM:4592,durationS:1163,provider:'TOMTOM_V1' as const,measuredAt:new Date(),paths:[[ [a.latitude,a.longitude],[b.latitude,b.longitude] ]as[number,number][]]});
const rejected=(work:Promise<unknown>,code:number)=>assert.rejects(work,(e:unknown)=>e instanceof AppError&&e.status===code);
const users:User[]=[];
let customer:User,other:User,courier:User,foot:User;
let updateId=Date.now();
const key='synthetic-routing-key-12345678';
before(async()=>{
  await migrate();
  for(const role of ['CUSTOMER','CUSTOMER','COURIER','COURIER']as const){
    const row=(await database().query('INSERT INTO qadam.users(email,name,role,password_hash) VALUES($1,$2,$3,$4) RETURNING id,email,name,role',
      [`pricing-${randomUUID()}@qadam.invalid`,'Pricing test',role,'unusable-test-password'])).rows[0];users.push(row);
  }
  [customer,other,courier,foot]=users;
  for(let i=0;i<users.length;i++){
    users[i].telegramId=String(4000000000+Math.floor(Math.random()*100000000));
    await database().query('INSERT INTO qadam.telegram_identities(telegram_user_id,user_id) VALUES($1,$2)',[users[i].telegramId,users[i].id]);
  }
  for(const [user,transport]of [[courier,'CAR'],[foot,'FOOT']]as const)await database().query(`INSERT INTO qadam.courier_applications(user_id,phone,transport,status,reviewed_at,reviewed_by) VALUES($1,'+77000000000',$2,'APPROVED',now(),$3)`,[user.id,transport,customer.id]);
  await database().query('TRUNCATE qadam.telegram_updates,qadam.telegram_outbox');
});
beforeEach(async()=>{
  mock.restoreAll();await database().query('UPDATE qadam.pricing_settings SET active=false,config=NULL');
  await database().query('DELETE FROM qadam.service_limits');
});
after(async()=>{
  mock.restoreAll();await database().query('UPDATE qadam.pricing_settings SET active=false,config=NULL');
  await database().query('DELETE FROM qadam.orders WHERE customer_id=ANY($1::uuid[])',[users.map(u=>u.id)]);
  await database().query('DELETE FROM qadam.telegram_outbox WHERE telegram_user_id=ANY($1::bigint[])',[users.map(u=>u.telegramId)]);
  await database().query('DELETE FROM qadam.telegram_bot_chats WHERE telegram_user_id=ANY($1::bigint[])',[users.map(u=>u.telegramId)]);
  await database().query('DELETE FROM qadam.courier_applications WHERE user_id=ANY($1::uuid[])',[users.map(u=>u.id)]);
  await database().query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])',[users.map(u=>u.id)]);
  await closeDatabase();
});
async function enable(){await database().query('UPDATE qadam.pricing_settings SET active=true,config=$1',[JSON.stringify(tariff)]);}
async function phone(user:User){await saveTelegramContact(user.telegramId!,'+77000000000',++updateId);}

test('price uses integer boundaries, minimum and zero commission without counting traffic twice',()=>{
  for(const [m,s,total]of [[2428,358,1200],[4592,1163,1400],[13473,2087,2200],[5000,1200,1400],[5000,2400,1650]]){
    const p=calculatePrice(tariff,m,s);assert.equal(p.totalKzt,total);assert.equal(p.platformFeeKzt,0);assert.equal(p.courierPayoutKzt,total);
    assert.equal(Math.round((p.baseKzt+p.distanceKzt+p.timeKzt+p.minimumAdjustmentKzt+p.roundingKzt)*100),total*100);
  }
  const exact={...tariff,minimumKzt:0,baseKzt:0,perKmKzt:1,perMinuteKzt:0,roundToKzt:50};
  assert.equal(calculatePrice(exact,50000,1).totalKzt,50);assert.equal(calculatePrice(exact,50001,1).totalKzt,100);
  for(const m of [NaN,Infinity,-1,0,1.5,100001])assert.throws(()=>calculatePrice(tariff,m,60));
});
test('disabled pricing is closed, input is strict and a courier cannot request customer quotes',async()=>{
  await rejected(createQuote(customer,input(),metrics),503);
  await enable();await rejected(createQuote(courier,input(),metrics),403);
  await rejected(createQuote(customer,{...input(),priceKzt:1},metrics),400);
  await rejected(createQuote(customer,{...input(),pickupPoint:{latitude:0,longitude:0}},metrics),422);
  assert.equal(createOrderSchema.safeParse({...input(),requestKey:randomUUID(),priceKzt:1}).success,false);
  assert.notEqual(quoteFingerprint(input()),quoteFingerprint({...input(),paymentMethod:'KASPI_TRANSFER'}));
});
test('quotes bind ownership and terms, prevent reuse and preserve idempotency after expiry',async()=>{
  await enable();await phone(customer);await phone(courier);
  const data=input(),quote=await createQuote(customer,data,metrics);
  const request={...data,quoteId:quote.id,requestKey:randomUUID()};
  await rejected(createOrder(other,request),409);
  await rejected(createOrder(customer,{...request,notes:'Изменённый груз'}),409);
  const [first,retry]=await Promise.all([createOrder(customer,request),createOrder(customer,request)]);
  assert.equal(first.id,retry.id);assert.equal(first.pricing?.priceKzt,1400);assert.equal(first.senderPhone,'+77000000000');
  await database().query("UPDATE qadam.order_quotes SET expires_at=created_at+interval '1 millisecond',created_at=created_at-interval '1 hour' WHERE id=$1",[quote.id]);
  assert.equal((await createOrder(customer,request)).id,first.id);
  await rejected(createOrder(customer,{...request,requestKey:randomUUID()}),409);
  assert.equal((await listOrders(foot)).some(o=>o.id===first.id),false);
  await rejected(getOrder(foot,first.id),404);await rejected(acceptOrder(foot,first.id,true),403);
  const visible=(await listOrders(courier)).find(o=>o.id===first.id)!;
  assert.equal(visible.senderPhone,null);assert.equal(visible.recipientPhone,null);assert.equal(visible.courierPhone,null);
  await database().query('UPDATE qadam.pricing_settings SET config=$1',[JSON.stringify({...tariff,baseKzt:9000})]);
  await rejected(acceptOrder(courier,first.id),409);
  const accepted=await acceptOrder(courier,first.id,true);
  assert.equal(accepted.pricing?.priceKzt,1400);assert.equal(accepted.senderPhone,'+77000000000');assert.equal(accepted.courierPhone,'+77000000000');
  assert.equal((await getOrder(customer,first.id)).courierPhone,'+77000000000');
  await rejected(getOrder(other,first.id),404);
});
test('expired or concurrently reused quote cannot create another order; new priced orders need own phone',async()=>{
  await enable();const data=input();
  const quote=await createQuote(other,data,metrics);
  await rejected(createOrder(other,{...data,quoteId:quote.id,requestKey:randomUUID()}),409);
  await phone(other);
  const results=await Promise.allSettled([createOrder(other,{...data,quoteId:quote.id,requestKey:randomUUID()}),createOrder(other,{...data,quoteId:quote.id,requestKey:randomUUID()})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  await database().query("DELETE FROM qadam.service_limits WHERE bucket LIKE 'quote:second:%'");
  const expired=await createQuote(other,data,metrics);
  await database().query("UPDATE qadam.order_quotes SET created_at=now()-interval '1 hour',expires_at=now()-interval '1 minute' WHERE id=$1",[expired.id]);
  await rejected(createOrder(other,{...data,quoteId:expired.id,requestKey:randomUUID()}),409);
  const noPrice=await createOrderSchema.parseAsync({...data,requestKey:randomUUID()});
  await rejected(createOrder(other,noPrice),409);
});
test('own Telegram contact is authoritative, old updates and wrong user contacts cannot replace it',async()=>{
  const user=other,telegramId=Number(user.telegramId);
  const send=async(contact:Record<string,unknown>,extra:Record<string,unknown>={})=>{
    await receiveTelegramUpdate({update_id:++updateId,message:{message_id:1,from:{id:telegramId},chat:{id:telegramId,type:'private'},contact,...extra}});
    await processTelegramJobs(async()=>({message_id:1}));
  };
  await send({user_id:telegramId,phone_number:'+7 701 000 00 01'});
  assert.equal((await phoneProfile(user)).phone,'+77010000001');
  await send({user_id:Number(customer.telegramId),phone_number:'+77010000002'});
  await send({phone_number:'+77010000003'});
  await send({user_id:telegramId,phone_number:'+77010000004'},{chat:{id:telegramId,type:'group'}});
  await saveTelegramContact(user.telegramId!,'+77010000005',updateId-100);
  assert.equal((await phoneProfile(user)).phone,'+77010000001');
});
test('routing adapter rejects missing traffic fields, bad endpoints, oversized responses and secret-bearing failures',async()=>{
  const old=process.env.TOMTOM_API_KEY;process.env.TOMTOM_API_KEY=key;
  const response={routes:[{summary:{lengthInMeters:4592,travelTimeInSeconds:1163,noTrafficTravelTimeInSeconds:600,historicTrafficTravelTimeInSeconds:800,liveTrafficIncidentsTravelTimeInSeconds:1163},legs:[{points:[a,b]}]}]};
  try{
    mock.method(globalThis,'fetch',async()=>Response.json(response));assert.equal((await quoteRoute(a,b)).durationS,1163);mock.restoreAll();
    for(const body of [{routes:[{...response.routes[0],summary:{lengthInMeters:4592,travelTimeInSeconds:1163}}]},{routes:[{...response.routes[0],legs:[{points:[{latitude:0,longitude:0},b]}]}]}]){
      mock.method(globalThis,'fetch',async()=>Response.json(body));await rejected(quoteRoute(a,b),503);mock.restoreAll();
    }
    mock.method(globalThis,'fetch',async()=>new Response('x'.repeat(1048577)));await rejected(quoteRoute(a,b),503);mock.restoreAll();
    mock.method(globalThis,'fetch',async()=>{throw new Error(`secret=${key}`);});
    await assert.rejects(quoteRoute(a,b),(e:unknown)=>e instanceof AppError&&!e.message.includes(key));mock.restoreAll();
    mock.method(globalThis,'fetch',async()=>new Response('',{status:429}));await rejected(quoteRoute(a,b),429);
  }finally{mock.restoreAll();if(old===undefined)delete process.env.TOMTOM_API_KEY;else process.env.TOMTOM_API_KEY=old;}
});
