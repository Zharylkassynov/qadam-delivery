import {createCipheriv,createDecipheriv,createHmac,randomBytes,randomInt,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {database,transaction} from './db';
import {AppError} from './errors';
import type {Db} from './telegram-outbox';
import type {User} from './types';
import {codeKey} from './proof-settings';
import {handoffPolicy} from './handoff-settings';
import {distanceBetween} from './geo-distance';
import {locationConsentVersion} from './location-consent';
import {requireAdministrator} from './administrators';
import {actionFields,assertVersion,lockedOrder,lockCouriers,parseTrust,priorAction,privateOrder,reasonSchema,requireCourierAccess,saveAction,trustEvent,type ActionResult,type TrustOrder} from './trust-core';
import {queueCustomerOrderStatus} from './order-notifications';
import {enqueueBotMessage} from './telegram-outbox';

export type HandoffStage='PICKUP'|'DROPOFF';
const stageSchema=z.enum(['PICKUP','DROPOFF']);
const fields={...actionFields,expectedRouteVersion:z.number().int().min(0)};
const confirmSchema=z.object({...fields,stage:stageSchema,code:z.string().regex(/^\d{6}$/),handedOver:z.literal(true)}).strict();
const issueSchema=z.object({...fields,stage:stageSchema,reset:z.boolean().default(false),reason:reasonSchema.optional()}).strict();
const pointCorrectionSchema=z.object({...fields,stage:stageSchema,reason:reasonSchema,address:z.string().trim().min(5).max(200),point:z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180)}).strict()}).strict();
const key=(domain:string)=>createHmac('sha256',codeKey()).update(`qadam-handoff-${domain}-v1`).digest();
const binding=(order:TrustOrder,stage:HandoffStage,version:number)=>`${order.id}:${stage}:${order.assignment_version}:${order.route_version}:${version}`;
const verifier=(order:TrustOrder,stage:HandoffStage,version:number,code:string)=>createHmac('sha256',key('verifier')).update(`${binding(order,stage,version)}:${code}`).digest('hex');
const requestHash=(data:unknown)=>createHmac('sha256',key('request')).update(JSON.stringify(data)).digest('hex');
function seal(order:TrustOrder,stage:HandoffStage,version:number,code:string){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key('encryption'),iv);cipher.setAAD(Buffer.from(binding(order,stage,version)));
  const bytes=Buffer.concat([cipher.update(code,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64');
}
function open(order:TrustOrder,stage:HandoffStage,version:number,value:string){
  try{const raw=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',key('encryption'),raw.subarray(0,12));cipher.setAAD(Buffer.from(binding(order,stage,version)));cipher.setAuthTag(raw.subarray(12,28));const code=Buffer.concat([cipher.update(raw.subarray(28)),cipher.final()]).toString('utf8');if(!/^\d{6}$/.test(code))throw new Error();return code;}catch{throw new AppError(503,'Код временно недоступен. Напишите в поддержку.');}
}
function assertRoute(order:TrustOrder,version:number){if(order.route_version!==version)throw new AppError(409,'Адрес изменился. Обновите заказ.');}
function assertStage(order:TrustOrder,stage:HandoffStage){
  if(!order.courier_id)throw new AppError(409,'Дождитесь назначения курьера.');
  if(stage==='PICKUP'&&order.status!=='ACCEPTED')throw new AppError(409,'Подтверждение забора сейчас недоступно.');
  if(stage==='DROPOFF'&&(!['PICKED_UP','IN_TRANSIT'].includes(order.status)||order.custody_assignment_version!==order.assignment_version))throw new AppError(409,'Сначала подтвердите забор посылки.');
}

export async function handoffPresence(db:Db,order:TrustOrder,stage:HandoffStage){
  const point=stage==='PICKUP'?{latitude:order.pickup_latitude,longitude:order.pickup_longitude}:{latitude:order.destination_latitude,longitude:order.destination_longitude};
  if(point.latitude===null||point.longitude===null)return{ready:false as const,message:'Отправителю нужно уточнить точку на карте.',distanceM:null,location:null};
  // Use the server's order feed. It accepts Mini App fixes and verified Telegram
  // live updates, and belongs to the current assignment. Never trust POST coordinates.
  const location=(await db.query(`SELECT l.latitude,l.longitude,l.accuracy,l.captured_at,l.received_at,l.location_source,
    (s.online AND s.updated_at>clock_timestamp()-interval '8 hours' AND p.sharing AND p.consent_at IS NOT NULL
      AND p.auto_consent_at IS NOT NULL AND p.auto_consent_version=$3 AND l.received_at>=s.updated_at
      AND l.captured_at>clock_timestamp()-interval '60 seconds' AND l.received_at>clock_timestamp()-interval '60 seconds'
      AND l.captured_at<=clock_timestamp()+interval '10 seconds' AND l.received_at<=clock_timestamp()+interval '10 seconds') AS fresh
    FROM qadam.courier_locations l JOIN qadam.courier_status s ON s.user_id=l.courier_id
    JOIN qadam.courier_presence p ON p.user_id=l.courier_id WHERE l.order_id=$1 AND l.courier_id=$2`,[order.id,order.courier_id,locationConsentVersion])).rows[0];
  if(!location?.fresh)return{ready:false as const,message:'Обновите геопозицию у адреса.',distanceM:null,location:null};
  const distanceM=distanceBetween({latitude:point.latitude,longitude:point.longitude},location);
  if(location.accuracy===null||location.accuracy>handoffPolicy.accuracyM)return{ready:false as const,message:'GPS неточный. Выйдите на открытое место и обновите позицию.',distanceM,location:null};
  if(distanceM===null||distanceM>handoffPolicy.radiusM)return{ready:false as const,message:stage==='PICKUP'?'Подойдите к отправителю. Подтверждение доступно у адреса.':'Подойдите к получателю. Подтверждение доступно у адреса.',distanceM,location:null};
  return{ready:true as const,message:'Вы у адреса. Попросите код при передаче.',distanceM,location};
}
async function requirePresence(db:Db,order:TrustOrder,stage:HandoffStage){const presence=await handoffPresence(db,order,stage);if(!presence.ready)throw new AppError(409,presence.message);return presence;}
const current=(row:Record<string,unknown>|undefined,order:TrustOrder)=>!!row&&row.assignment_version===order.assignment_version&&row.route_version===order.route_version;

export async function handoffInfo(db:Db,order:TrustOrder){
  const stage:HandoffStage=order.status==='ACCEPTED'?'PICKUP':'DROPOFF';
  const active=['ACCEPTED','PICKED_UP','IN_TRANSIT'].includes(order.status);
  const presence=active?await handoffPresence(db,order,stage):null;
  const row=active?(await db.query('SELECT assignment_version,route_version,attempts,expires_at,expires_at>clock_timestamp() AS valid,verified_at FROM qadam.order_handoffs WHERE order_id=$1 AND stage=$2',[order.id,stage])).rows[0]:null;
  return{required:true,stage,routeVersion:order.route_version,ready:presence?.ready??false,message:presence?.message??'',distanceM:presence?.distanceM??null,
    codeReady:!!(current(row,order)&&row.valid&&!row.verified_at&&row.attempts<5),attemptsRemaining:current(row,order)?5-row.attempts:null,
    expiresAt:current(row,order)?row.expires_at:null,missingPickup:order.pickup_latitude===null,missingDestination:order.destination_latitude===null};
}

export async function viewHandoffCode(actor:User,id:string,stage:HandoffStage){
  stageSchema.parse(stage);
  return transaction(async db=>{
    await privateOrder(db,actor,id);const order=await lockedOrder(db,id);
    if(order.customer_id!==actor.id)throw new AppError(403,'Код видит только отправитель.');
    assertStage(order,stage);
    const row=(await db.query('SELECT *,expires_at>clock_timestamp() AS valid FROM qadam.order_handoffs WHERE order_id=$1 AND stage=$2',[id,stage])).rows[0];
    if(!current(row,order)||row.verified_at)return{code:null,expiresAt:null,attemptsRemaining:null};
    return{code:row.valid&&row.attempts<5?open(order,stage,row.version,row.encrypted_code):null,expiresAt:row.expires_at,attemptsRemaining:5-row.attempts};
  });
}

export async function issueHandoffCode(actor:User,id:string,input:unknown){
  const data=parseTrust(issueSchema,input),hash=requestHash(data);
  return transaction(async db=>{
    await privateOrder(db,actor,id);const order=await lockedOrder(db,id);
    if(order.customer_id!==actor.id){if(!data.reset)throw new AppError(403,'Код выпускает отправитель.');await requireAdministrator(db,actor);}
    assertVersion(order,data.expectedVersion);assertRoute(order,data.expectedRouteVersion);assertStage(order,data.stage);
    const old=await priorAction(db,actor,id,data.requestKey,'HANDOFF_CODE',hash);if(old)return old;
    const row=(await db.query('SELECT *,reset_at>clock_timestamp()-interval \'1 minute\' AS recent FROM qadam.order_handoffs WHERE order_id=$1 AND stage=$2 FOR UPDATE',[id,data.stage])).rows[0];
    if(current(row,order)&&!data.reset)return saveAction(db,actor,id,data.requestKey,'HANDOFF_CODE',hash,{ok:true});
    if(data.reset&&!data.reason)throw new AppError(400,'Укажите причину нового кода.');
    const resets:Date[]=(row?.reset_history??[]).filter((at:Date)=>new Date(at).getTime()>Date.now()-3600000);
    if(data.reset&&(row?.recent||resets.length>=3))throw new AppError(429,'Код недавно менялся. Повторите позже.');
    if(data.stage==='PICKUP')await requirePresence(db,order,'PICKUP');
    if(data.stage==='DROPOFF'&&(!order.custody_at||new Date(order.custody_at).getTime()+86400000<=Date.now()))throw new AppError(410,'Срок вручения истёк. Свяжитесь с поддержкой для разбора или возврата.');
    const version=(row?.version??0)+1;let code:string;
    // Neither the preceding code nor the other handoff's code may remain valid by chance.
    const other=(await db.query('SELECT stage,version,encrypted_code,assignment_version,route_version FROM qadam.order_handoffs WHERE order_id=$1 AND stage<>$2',[id,data.stage])).rows[0];
    let previousCode:string|undefined,otherCode:string|undefined;
    if(row)previousCode=open({...order,assignment_version:row.assignment_version,route_version:row.route_version},data.stage,row.version,row.encrypted_code);
    if(current(other,order))otherCode=open(order,other.stage,other.version,other.encrypted_code);
    do{code=String(randomInt(1000000)).padStart(6,'0');}while(code===previousCode||code===otherCode);
    if(data.reset)resets.push(new Date());
    await db.query(`INSERT INTO qadam.order_handoffs(order_id,stage,assignment_version,route_version,version,verifier,encrypted_code,expires_at,reset_history)
      VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $2='PICKUP' THEN clock_timestamp()+interval '15 minutes' ELSE $9::timestamptz+interval '24 hours' END,$8)
      ON CONFLICT(order_id,stage) DO UPDATE SET assignment_version=excluded.assignment_version,route_version=excluded.route_version,version=excluded.version,
      verifier=excluded.verifier,encrypted_code=excluded.encrypted_code,issued_at=clock_timestamp(),expires_at=excluded.expires_at,attempts=0,verified_at=NULL,reset_at=clock_timestamp(),reset_history=excluded.reset_history`,
      [id,data.stage,order.assignment_version,order.route_version,version,verifier(order,data.stage,version,code),seal(order,data.stage,version,code),resets,order.custody_at]);
    await trustEvent(db,order,actor,data.reset?'HANDOFF_CODE_RESET':'HANDOFF_CODE_ISSUED',data.reason??null);
    return saveAction(db,actor,id,data.requestKey,'HANDOFF_CODE',hash,{ok:true});
  });
}

export async function confirmHandoff(actor:User,id:string,input:unknown){
  const data=parseTrust(confirmSchema,input),hash=requestHash(data);
  const result:ActionResult=await transaction(async db=>{
    await lockCouriers(db,[actor.id]);await requireCourierAccess(db,actor.id);const order=await lockedOrder(db,id);
    if(order.courier_id!==actor.id)throw new AppError(403,'Этот заказ вам не назначен.');
    assertVersion(order,data.expectedVersion);assertRoute(order,data.expectedRouteVersion);
    const old=await priorAction(db,actor,id,data.requestKey,'HANDOFF',hash);if(old)return old;
    assertStage(order,data.stage);
    const presence=await requirePresence(db,order,data.stage);
    const row=(await db.query('SELECT *,expires_at>clock_timestamp() AS valid FROM qadam.order_handoffs WHERE order_id=$1 AND stage=$2 FOR UPDATE',[id,data.stage])).rows[0];
    if(!current(row,order))throw new AppError(409,'Попросите отправителя открыть код передачи.');
    if(row.verified_at)throw new AppError(409,'Передача уже подтверждена. Обновите заказ.');
    if(!row.valid)throw new AppError(410,'Код истёк. Попросите отправителя выпустить новый.');
    if(row.attempts>=5)throw new AppError(423,'Попытки закончились. Нужен новый код отправителя.');
    const actual=Buffer.from(verifier(order,data.stage,row.version,data.code),'hex'),expected=Buffer.from(row.verifier,'hex');
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){
      await db.query('UPDATE qadam.order_handoffs SET attempts=attempts+1 WHERE order_id=$1 AND stage=$2',[id,data.stage]);
      await trustEvent(db,order,actor,'HANDOFF_CODE_REJECTED');
      return saveAction(db,actor,id,data.requestKey,'HANDOFF',hash,{ok:false,status:row.attempts===4?423:400,message:row.attempts===4?'Попытки закончились. Нужен новый код отправителя.':`Код не подошёл. Осталось попыток: ${4-row.attempts}.`});
    }
    const photo=data.stage==='DROPOFF'?(await db.query("SELECT id,file_id FROM qadam.order_photos WHERE order_id=$1 AND courier_id=$2 AND assignment_version=$3 AND state='READY' AND expires_at>clock_timestamp() ORDER BY created_at DESC,id DESC LIMIT 1",[id,actor.id,order.assignment_version])).rows[0]:null;
    if(data.stage==='DROPOFF'&&order.photo_required&&!photo)throw new AppError(409,'Добавьте фото вручения.');
    const location=presence.location!;
    await db.query(`INSERT INTO qadam.order_handoff_proofs(order_id,stage,courier_id,assignment_version,route_version,code_version,latitude,longitude,accuracy,distance_m,captured_at,received_at,location_source)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[id,data.stage,actor.id,order.assignment_version,order.route_version,row.version,location.latitude,location.longitude,location.accuracy,presence.distanceM,location.captured_at,location.received_at,location.location_source]);
    await db.query('UPDATE qadam.order_handoffs SET verified_at=clock_timestamp() WHERE order_id=$1 AND stage=$2',[id,data.stage]);
    const status=data.stage==='PICKUP'?'IN_TRANSIT':'DELIVERED';
    await db.query("UPDATE qadam.orders SET status=$2,custody_assignment_version=CASE WHEN $3='PICKUP' THEN assignment_version ELSE custody_assignment_version END,custody_at=CASE WHEN $3='PICKUP' THEN clock_timestamp() ELSE custody_at END,updated_at=clock_timestamp() WHERE id=$1",[id,status,data.stage]);
    const target=data.stage==='PICKUP'?`${order.pickup_latitude}, ${order.pickup_longitude}`:`${order.destination_latitude}, ${order.destination_longitude}`;
    const evidence=`Точка ${data.stage==='PICKUP'?'А':'Б'}: ${target}; маршрут ${order.route_version}; назначение ${order.assignment_version}.`;
    if(data.stage==='PICKUP')await trustEvent(db,{...order,status:'PICKED_UP'},actor,'PICKUP_VERIFIED',evidence);
    await trustEvent(db,{...order,status},actor,data.stage==='PICKUP'?'STATUS':'DROPOFF_VERIFIED',data.stage==='DROPOFF'?evidence:null);
    await queueCustomerOrderStatus(db,id,status);
    if(photo){const receiver=(await db.query('SELECT telegram_user_id::text AS chat FROM qadam.telegram_identities WHERE user_id=$1 AND allows_write AND bot_blocked_at IS NULL',[order.customer_id])).rows[0];if(receiver)await enqueueBotMessage(db,`order:${id}:proof:${photo.id}`,receiver.chat,{chat_id:receiver.chat,photo:photo.file_id,caption:`Фото вручения QD-${order.number.padStart(4,'0')}`},'sendPhoto',{orderId:id});}
    return saveAction(db,actor,id,data.requestKey,'HANDOFF',hash,{ok:true});
  });
  // Failed attempts intentionally commit, including an idempotent error result.
  if(!result.ok)throw new AppError(result.status??400,result.message??'Код не подошёл.');
  const {getOrder}=await import('./orders');return getOrder(actor,id);
}

export async function correctHandoffPoint(actor:User,id:string,input:unknown){
  const data=parseTrust(pointCorrectionSchema,input),hash=requestHash(data);
  await transaction(async db=>{
    await privateOrder(db,actor,id);const order=await lockedOrder(db,id);
    const missing=data.stage==='PICKUP'?order.pickup_latitude===null:order.destination_latitude===null;
    // Customers can repair a missing legacy pin; moving an existing delivery
    // destination requires an administrator's recorded decision.
    if(order.customer_id!==actor.id||!missing)await requireAdministrator(db,actor);
    assertVersion(order,data.expectedVersion);
    const previous=await priorAction(db,actor,id,data.requestKey,'POINT_CORRECTION',hash);if(previous)return;
    assertRoute(order,data.expectedRouteVersion);
    if(['DELIVERED','CANCELLED'].includes(order.status))throw new AppError(409,'Доставка уже завершена.');
    if(order.price_kzt!==null)throw new AppError(409,'Для изменения адреса с фиксированной ценой согласуйте новый заказ с поддержкой.');
    if(data.stage==='PICKUP'&&['PICKED_UP','IN_TRANSIT'].includes(order.status))throw new AppError(409,'Точку забора после передачи изменить нельзя.');
    const prefix=data.stage==='PICKUP'?'pickup':'destination';
    await db.query(`UPDATE qadam.orders SET ${prefix}_address=$2,${prefix}_latitude=$3,${prefix}_longitude=$4,route_version=route_version+1,updated_at=clock_timestamp() WHERE id=$1`,[id,data.address,data.point.latitude,data.point.longitude]);
    await db.query("UPDATE qadam.order_photos SET state='RETIRED' WHERE order_id=$1 AND state IN ('READY','UPLOADING')",[id]);
    await trustEvent(db,order,actor,'POINT_CORRECTED',data.reason);
    await saveAction(db,actor,id,data.requestKey,'POINT_CORRECTION',hash,{ok:true});
  });
  const {getOrder}=await import('./orders');return getOrder(actor,id);
}
