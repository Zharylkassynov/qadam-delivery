import {before,beforeEach,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database,closeDatabase} from '../src/lib/db';
import {migrate} from '../scripts/migrate';
import {createOrder,listOrders,acceptOrder,selectOrder} from '../src/lib/orders';
import {courierQueueQuery} from '../src/lib/courier-queue';
import {getCourierStatus,setCourierStatus} from '../src/lib/courier-status';
import {saveLocationSettings} from '../src/lib/courier-location-settings';
import {updateCourierPresence} from '../src/lib/courier-presence';
import {locationConsentVersion} from '../src/lib/location-consent';
import type {User,MapPoint} from '../src/lib/types';

const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test')||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('Separate local _test database required');
process.env.DATABASE_URL=url;process.env.TELEGRAM_WORKER_ENABLED='false';
let customer:User,courier:User;const users:User[]=[];
const start={latitude:43.24,longitude:76.9};
const input=(pickupPoint:MapPoint|null=start,destinationPoint:MapPoint|null={latitude:43.25,longitude:76.9})=>({requestKey:randomUUID(),pickupAddress:'Алматы, очередь проверки 10',destinationAddress:'Алматы, адрес доставки 20',recipientName:'Закрытый получатель',recipientPhone:'+77000000000',notes:'',pickupPoint,destinationPoint});
async function ready(){await saveLocationSettings(courier,{autoEnabled:true,consentVersion:locationConsentVersion});await setCourierStatus(courier,{online:true});await updateCourierPresence(courier,{...start,accuracy:20,capturedAt:new Date().toISOString()});}
before(async()=>{
  await migrate();for(const role of ['CUSTOMER','COURIER'] as const)users.push((await database().query("INSERT INTO qadam.users(email,name,role,password_hash) VALUES($1,'Queue fixture',$2,'unused') RETURNING id,email,name,role",[`queue-${randomUUID()}@qadam.invalid`,role])).rows[0]);
  [customer,courier]=users;
  await database().query("INSERT INTO qadam.telegram_identities(user_id,telegram_user_id) VALUES($1,$2)",[courier.id,String(8300000000000+Math.floor(Math.random()*1e9))]);
  await database().query("INSERT INTO qadam.courier_applications(user_id,phone,transport,status,reviewed_at,reviewed_by) VALUES($1,'+77000000000','FOOT','APPROVED',now(),$2)",[courier.id,customer.id]);
});
beforeEach(async()=>{process.env.DELIVERY_PROOF_ENABLED='false';await database().query('UPDATE qadam.pricing_settings SET active=false,config=NULL');await database().query('DELETE FROM qadam.orders WHERE customer_id=$1',[customer.id]);await database().query('DELETE FROM qadam.courier_status WHERE user_id=$1',[courier.id]);await database().query('DELETE FROM qadam.courier_presence WHERE user_id=$1',[courier.id]);});
after(async()=>{await database().query('DELETE FROM qadam.orders WHERE customer_id=$1',[customer.id]);await database().query('DELETE FROM qadam.courier_applications WHERE user_id=$1',[courier.id]);await database().query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])',[users.map(u=>u.id)]);await closeDatabase();});

test('nearest available order is selected before LIMIT while urgency remains a higher priority',async()=>{
  await ready();const near=await createOrder(customer,input());
  await database().query("UPDATE qadam.orders SET created_at=now()-interval '2 days' WHERE id=$1",[near.id]);
  await database().query(`INSERT INTO qadam.orders(customer_id,request_key,pickup_address,destination_address,recipient_name,recipient_phone,status,pickup_latitude,pickup_longitude,destination_latitude,destination_longitude)
    SELECT $1,gen_random_uuid(),'Далёкий забор для очереди','Адрес доставки очереди','Закрытый получатель','+77000000000','SEARCHING_FOR_COURIER',43.3,76.9,43.31,76.9 FROM generate_series(1,120)`,[customer.id]);
  const urgent=await createOrder(customer,{...input({latitude:43.29,longitude:76.9},{latitude:43.3,longitude:76.9}),urgent:true});
  const missingDestination=await createOrder(customer,input({latitude:43.5,longitude:76.9},null));
  const orders=(await listOrders(courier)).filter(o=>o.customerId===customer.id);
  assert.equal(orders[0].id,urgent.id);assert.equal(orders[1].id,near.id);assert.equal(orders[1].pickupDistanceM,0);
  assert.ok(orders.some(o=>o.id===missingDestination.id));
  assert.equal(orders[0].recipientPhone,null);assert.equal(orders[0].recipientName,null);
  const customers=await listOrders(customer);assert.equal('pickupDistanceM' in customers[0],false);
});
test('foot filter keeps unknown endpoints, supports all deliveries and is not a restriction on acceptance',async()=>{
  await ready();const short=await createOrder(customer,input(start,{latitude:43.275,longitude:76.9}));
  const long=await createOrder(customer,input(start,{latitude:43.277,longitude:76.9}));
  const unknown=await createOrder(customer,input(null,null));
  const selected=(await listOrders(courier)).filter(o=>o.customerId===customer.id);
  assert.ok(selected.some(o=>o.id===short.id));assert.ok(selected.some(o=>o.id===unknown.id));assert.equal(selected.some(o=>o.id===long.id),false);
  assert.equal(selected.find(o=>o.id===unknown.id)?.pickupDistanceM,null);assert.equal(selected.find(o=>o.id===unknown.id)?.deliveryDistanceM,null);
  assert.ok((await listOrders(courier,false)).some(o=>o.id===long.id));
  assert.equal((await acceptOrder(courier,long.id)).courierId,courier.id);
  assert.ok((await listOrders(courier)).some(o=>o.id===long.id));
  assert.equal((await getCourierStatus(courier)).transport,'FOOT');
});
test('stale receipt, stale capture and revoked sharing independently hide origin distance',async()=>{
  await ready();const order=await createOrder(customer,input());
  for(const assignment of ["received_at=clock_timestamp()-interval '91 seconds'","captured_at=clock_timestamp()-interval '91 seconds'",'sharing=false']){
    await database().query('UPDATE qadam.courier_presence SET sharing=true,captured_at=clock_timestamp(),received_at=clock_timestamp() WHERE user_id=$1',[courier.id]);
    await database().query(`UPDATE qadam.courier_presence SET ${assignment} WHERE user_id=$1`,[courier.id]);
    const read=(await listOrders(courier)).find(o=>o.id===order.id)!;
    assert.equal(read.pickupDistanceM,null);assert.ok(read.deliveryDistanceM!>1000);
  }
});
test('queue query plan is executable with bounded queues on realistic local data',async()=>{
  await ready();await createOrder(customer,input());
  const query=courierQueueQuery(selectOrder,'false',"o.courier_id=$1 OR (o.courier_id IS NULL AND o.status='SEARCHING_FOR_COURIER')");
  const result=await database().query(`EXPLAIN (ANALYZE,FORMAT JSON) ${query}`,[courier.id,true]);
  const plan=result.rows[0]['QUERY PLAN'][0];assert.ok(plan.Plan['Actual Rows']<=400);
  assert.ok(JSON.stringify(plan.Plan).includes('Limit'));
});
