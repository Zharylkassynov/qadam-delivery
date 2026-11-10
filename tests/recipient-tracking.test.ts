import {after,before,beforeEach,test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {database,closeDatabase} from '../src/lib/db';
import {migrate} from '../scripts/migrate';
import {createOrder,acceptOrder,transitionOrder,getOrder} from '../src/lib/orders';
import {recipientLink,recipientPreference,publicRecipientDelivery,takeRecipientBudget} from '../src/lib/recipient-tracking';
import {recipientConsentVersion,whatsAppLink} from '../src/lib/recipient-tracking-types';
import {readyCourier} from './courier-ready-fixture';
import {AppError} from '../src/lib/errors';
import {readFile} from 'node:fs/promises';
import {transaction} from '../src/lib/db';
import type {User} from '../src/lib/types';
import {GET as publicGET} from '../src/app/api/recipient-tracking/route';
import {GET as tileGET} from '../src/app/api/recipient-tiles/[z]/[x]/[y]/route';
import {POST as linkPOST} from '../src/app/api/orders/[id]/recipient-link/route';

const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test')||!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw new Error('Local _test database required');
process.env.DATABASE_URL=url;process.env.TELEGRAM_WORKER_ENABLED='false';process.env.APP_ORIGIN='http://127.0.0.1:3100';
const accounts:User[]=[];let owner:User,other:User,courier:User,next:User,session='';
const payload=()=>({requestKey:randomUUID(),pickupAddress:'Секретный адрес отправителя 123',destinationAddress:'Секретный адрес получателя 456',recipientName:'Закрытый получатель',recipientPhone:'+77001234567',notes:'Закрытая записка'});
const denied=(work:Promise<unknown>,code:number)=>assert.rejects(work,e=>e instanceof AppError&&e.status===code);
const secret=(link:{url:string|null})=>new URL(link.url!).pathname.split('/').at(-1)!;
async function fixture(){const order=await createOrder(owner,payload());const link=await recipientLink(owner,order.id,'create');return{order,link,token:secret(link)};}
async function underway(){const f=await fixture();await readyCourier(courier);await acceptOrder(courier,f.order.id);await transitionOrder(courier,f.order.id,'PICKED_UP');await recipientPreference(courier,{enabled:true,consentVersion:recipientConsentVersion});return f;}
before(async()=>{
  await migrate();for(const [role,name] of [['CUSTOMER','Отправитель'],['CUSTOMER','Другой'],['COURIER','Арман Фамилия'],['COURIER','Новый Курьер']] as const){accounts.push((await database().query('INSERT INTO qadam.users(email,name,role,password_hash) VALUES($1,$2,$3,\'unused\') RETURNING id,email,name,role',[`recipient-${randomUUID()}@qadam.invalid`,name,role])).rows[0]);}
  [owner,other,courier,next]=accounts;session=randomBytes(32).toString('hex');
  await database().query("INSERT INTO qadam.sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[owner.id,createHash('sha256').update(session).digest('hex')]);
});
beforeEach(async()=>{
  process.env.DELIVERY_PROOF_ENABLED='false';delete process.env.GEOAPIFY_API_KEY;
  await database().query('UPDATE qadam.pricing_settings SET active=false,config=NULL');
  await database().query('DELETE FROM qadam.orders WHERE customer_id=$1',[owner.id]);
  await database().query('DELETE FROM qadam.courier_blocks WHERE user_id=ANY($1::uuid[])',[accounts.map(a=>a.id)]);
  await database().query('DELETE FROM qadam.recipient_location_preferences WHERE user_id=ANY($1::uuid[])',[accounts.map(a=>a.id)]);
  await database().query("DELETE FROM qadam.service_limits WHERE bucket LIKE 'recipient%' OR bucket LIKE 'tile:%'");
});
after(async()=>{await database().query('DELETE FROM qadam.orders WHERE customer_id=$1',[owner.id]);await database().query('DELETE FROM qadam.courier_blocks WHERE user_id=ANY($1::uuid[])',[accounts.map(a=>a.id)]);await database().query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])',[accounts.map(a=>a.id)]);await closeDatabase();});

test('links are explicit, owner-only, random and stable across concurrent retries; ordinary order JSON has no secret',async()=>{
  const order=await createOrder(owner,payload());assert.equal((await recipientLink(owner,order.id)).url,null);
  await denied(recipientLink(other,order.id,'create'),404);await denied(recipientLink(courier,order.id,'create'),404);
  const [a,b]=await Promise.all([recipientLink(owner,order.id,'create'),recipientLink(owner,order.id,'create')]);
  assert.equal(a.url,b.url);assert.match(secret(a),/^[\w-]{43}$/);assert.equal(Buffer.from(secret(a),'base64url').length,32);
  assert.ok(!JSON.stringify(await getOrder(owner,order.id)).includes(secret(a)));
  assert.ok(Date.parse(a.expiresAt!)-Date.now()>6.99*86400000);
});
test('revocation invalidates old URLs; replacement and maximum lifetime do not revive them',async()=>{
  const f=await fixture();await recipientLink(owner,f.order.id,'revoke');await denied(publicRecipientDelivery(f.token),404);
  const replacement=await recipientLink(owner,f.order.id,'create');assert.notEqual(secret(replacement),f.token);await denied(publicRecipientDelivery(f.token),404);
  await database().query("UPDATE qadam.orders SET tracking_issued_at=now()-interval '8 days',tracking_expires_at=now()-interval '1 day' WHERE id=$1",[f.order.id]);
  await denied(publicRecipientDelivery(secret(replacement)),404);
});
test('public response is a whitelist and surprise never exposes shop, pickup, people, codes, notes or IDs',async()=>{
  const f=await fixture();await database().query("UPDATE qadam.orders SET business_name='Закрытый магазин',surprise=true,card_text='Закрытая открытка' WHERE id=$1",[f.order.id]);
  const response=await publicGET(new Request('http://127.0.0.1:3100/api/recipient-tracking',{headers:{'X-Qadam-Tracking':f.token}}));
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control')!,/no-store/);assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.match(response.headers.get('x-robots-tag')!,/noindex/);
  const {delivery}=await response.json();assert.deepEqual(Object.keys(delivery).sort(),['status','businessName','deliverAfter','deliverBefore','courierName','location','lastMeasuredAt','checkedAt','expiresAt','mapAvailable'].sort());
  const raw=JSON.stringify(delivery);for(const value of [f.order.id,owner.id,courier.id,'Закрытый магазин','Закрытая открытка',...Object.values(payload()).filter(v=>typeof v==='string'&&v.length>15)])assert.ok(!raw.includes(value));
  assert.equal(delivery.businessName,null);assert.equal(delivery.location,null);
  await database().query('UPDATE qadam.orders SET surprise=false WHERE id=$1',[f.order.id]);assert.equal((await publicRecipientDelivery(f.token)).businessName,'Закрытый магазин');
});
test('old GPS consent is insufficient, new consent is explicit and no point appears before pickup',async()=>{
  const f=await fixture();await readyCourier(courier);await acceptOrder(courier,f.order.id);
  assert.equal((await recipientPreference(courier)).enabled,false);assert.equal((await publicRecipientDelivery(f.token)).courierName,null);
  await denied(recipientPreference(courier,{enabled:true,consentVersion:'old'}),400);
  await denied(recipientPreference(owner,{enabled:true,consentVersion:recipientConsentVersion}),403);
  await recipientPreference(courier,{enabled:true,consentVersion:recipientConsentVersion});
  const visible=await publicRecipientDelivery(f.token);assert.equal(visible.courierName,'Арман');assert.equal(visible.location,null);assert.equal(visible.lastMeasuredAt,null);
});
test('fresh position after pickup requires both clocks, active shift and current recipient consent',async()=>{
  const f=await underway();assert.ok((await publicRecipientDelivery(f.token)).location);
  for(const column of ['captured_at','received_at']){
    await database().query(`UPDATE qadam.courier_locations SET ${column}=now()-interval '91 seconds' WHERE order_id=$1`,[f.order.id]);
    assert.equal((await publicRecipientDelivery(f.token)).location,null);
    await database().query('UPDATE qadam.courier_locations SET captured_at=now(),received_at=now() WHERE order_id=$1',[f.order.id]);
  }
  await recipientPreference(courier,{enabled:false});const revoked=await publicRecipientDelivery(f.token);assert.equal(revoked.courierName,null);assert.equal(revoked.location,null);assert.equal(revoked.lastMeasuredAt,null);
  await recipientPreference(courier,{enabled:true,consentVersion:recipientConsentVersion});
  await database().query("UPDATE qadam.recipient_location_preferences SET consent_version='old' WHERE user_id=$1",[courier.id]);assert.equal((await publicRecipientDelivery(f.token)).location,null);
  await recipientPreference(courier,{enabled:true,consentVersion:recipientConsentVersion});
  await database().query('UPDATE qadam.courier_presence SET sharing=false WHERE user_id=$1',[courier.id]);assert.equal((await publicRecipientDelivery(f.token)).location,null);
});
test('changing the assignment, blocking courier or finishing immediately stops public coordinates',async()=>{
  const f=await underway();await recipientPreference(next,{enabled:true,consentVersion:recipientConsentVersion});await readyCourier(next);
  await database().query("INSERT INTO qadam.courier_blocks(user_id,blocked,reason,actor_id) VALUES($1,true,'Synthetic blocking check',$2)",[courier.id,owner.id]);
  assert.equal((await publicRecipientDelivery(f.token)).location,null);assert.equal((await publicRecipientDelivery(f.token)).courierName,null);
  await database().query('DELETE FROM qadam.courier_blocks WHERE user_id=$1',[courier.id]);
  await database().query('UPDATE qadam.orders SET courier_id=$2 WHERE id=$1',[f.order.id,next.id]);assert.equal((await publicRecipientDelivery(f.token)).location,null);
  await database().query('UPDATE qadam.orders SET courier_id=$2 WHERE id=$1',[f.order.id,courier.id]);
  await transitionOrder(courier,f.order.id,'IN_TRANSIT');await transitionOrder(courier,f.order.id,'DELIVERED');
  const delivered=await publicRecipientDelivery(f.token);assert.equal(delivered.location,null);assert.equal(delivered.courierName,null);assert.equal(delivered.lastMeasuredAt,null);
  // Compare with the immutable database event, not the host clock: Docker's
  // PostgreSQL clock can lead the Windows clock by a few milliseconds.
  const finalEvent=(await database().query("SELECT min(created_at) AS at FROM qadam.order_events WHERE order_id=$1 AND status='DELIVERED'",[f.order.id])).rows[0].at;
  assert.equal(Date.parse(delivered.expiresAt),new Date(finalEvent).getTime()+86400000);
  await database().query("UPDATE qadam.order_events SET created_at=now()-interval '25 hours' WHERE order_id=$1 AND status='DELIVERED'",[f.order.id]);
  await database().query('UPDATE qadam.orders SET updated_at=now() WHERE id=$1',[f.order.id]);
  await denied(publicRecipientDelivery(f.token),404);await denied(recipientLink(owner,f.order.id,'create'),409);
});
test('anonymous API rejects missing secrets and cannot mutate; link mutation needs authenticated owner and origin',async()=>{
  const f=await fixture();const api='http://127.0.0.1:3100/api';
  assert.equal((await publicGET(new Request(`${api}/recipient-tracking`))).status,404);
  const context={params:Promise.resolve({id:f.order.id})};
  for(const [headers,code]of [[{Origin:'https://evil.example','Content-Type':'application/json',Authorization:`Bearer ${session}`},403],[{Origin:'http://127.0.0.1:3100','Content-Type':'application/json'},401]] as const){
    const response=await linkPOST(new Request(`${api}/orders/${f.order.id}/recipient-link`,{method:'POST',headers,body:JSON.stringify({action:'revoke'})}),context);assert.equal(response.status,code);
  }
});
test('cancelled deliveries hide identity and GPS, and expire 24 hours after their final event',async()=>{
  const f=await fixture();await transitionOrder(owner,f.order.id,'CANCELLED');
  const delivery=await publicRecipientDelivery(f.token);assert.equal(delivery.status,'CANCELLED');assert.equal(delivery.location,null);assert.equal(delivery.courierName,null);
  await database().query("UPDATE qadam.order_events SET created_at=now()-interval '25 hours' WHERE order_id=$1 AND status='CANCELLED'",[f.order.id]);await denied(publicRecipientDelivery(f.token),404);
});
test('invalid secrets and maps are rate limited and counters persist after rejected requests',async context=>{
  const now=Date.now();context.mock.method(Date,'now',()=>now);
  const request=new Request('http://127.0.0.1:3100/api/recipient-tracking');
  for(let i=0;i<60;i++)await takeRecipientBudget(request,'invalid');
  await denied(takeRecipientBudget(request,'invalid'),429);
  const response=await publicGET(new Request(request,{headers:{'X-Qadam-Tracking':'invalid'}}));assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'60');
});
test('public tiles require fresh authorized position, constrain area, hide secrets and retain shared quota',async()=>{
  const f=await underway();process.env.GEOAPIFY_API_KEY='synthetic_geoapify_key_not_real_1234';
  const location=(await publicRecipientDelivery(f.token)).location!,z=15,n=2**z;
  const x=Math.floor((location.longitude+180)/360*n),y=Math.floor((1-Math.asinh(Math.tan(location.latitude*Math.PI/180))/Math.PI)/2*n);
  const request=new Request('http://127.0.0.1:3100/api/recipient-tiles/15/0/0',{headers:{'X-Qadam-Tracking':f.token}});
  const context=(a=x,b=y)=>({params:Promise.resolve({z:String(z),x:String(a),y:String(b)})});
  const fetcher=mock.method(globalThis,'fetch',async(input:unknown,init?:RequestInit)=>{assert.ok(!String(input).includes(f.token));assert.equal(init?.headers,undefined);return new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png'}});});
  try{
    assert.equal((await tileGET(request,context(x+100))).status,400);
    const image=await tileGET(request,context());assert.equal(image.status,200);assert.match(image.headers.get('cache-control')!,/no-store/);
    await recipientPreference(courier,{enabled:false});assert.equal((await tileGET(request,context())).status,404);
    assert.equal(fetcher.mock.callCount(),1);
  }finally{fetcher.mock.restore();}
});
test('WhatsApp is a prepared international-number link, never an automatic message',()=>{
  const target='https://qadam.invalid/t/abc';const link=new URL(whatsAppLink('+7 (700) 123-45-67',target)!);
  assert.equal(link.origin,'https://wa.me');assert.equal(link.pathname,'/77001234567');assert.equal(link.searchParams.get('text'),`Вам отправлена доставка Qadam. Следить за статусом: ${target}`);
  assert.equal(whatsAppLink('12345',target),null);
});

test('recipient consent table enforces RLS and permits the restricted application role only',async()=>{
  const sql=await readFile(new URL('../db/migrations/20261106040114_recipient_tracking.sql',import.meta.url),'utf8');
  await transaction(async db=>{
    await db.query('SAVEPOINT recipient_acl');
    if(!(await db.query("SELECT 1 FROM pg_roles WHERE rolname='qadam_app'")).rowCount)await db.query('CREATE ROLE qadam_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT');
    await db.query('GRANT USAGE ON SCHEMA qadam TO qadam_app');
    await db.query('DROP POLICY IF EXISTS recipient_location_server ON qadam.recipient_location_preferences');
    await db.query(sql.slice(sql.indexOf('ALTER TABLE qadam.recipient_location_preferences ENABLE ROW LEVEL SECURITY;')));
    await db.query('SET LOCAL ROLE qadam_app');
    await db.query('INSERT INTO qadam.recipient_location_preferences(user_id,enabled,consent_version,consented_at) VALUES($1,true,$2,now())',[courier.id,recipientConsentVersion]);
    assert.equal((await db.query('SELECT enabled FROM qadam.recipient_location_preferences WHERE user_id=$1',[courier.id])).rows[0].enabled,true);
    await db.query('UPDATE qadam.recipient_location_preferences SET enabled=false,revoked_at=now() WHERE user_id=$1',[courier.id]);
    await db.query('RESET ROLE');assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='qadam.recipient_location_preferences'::regclass")).rows[0].relrowsecurity,true);
    await db.query('ROLLBACK TO SAVEPOINT recipient_acl');
  });
});
