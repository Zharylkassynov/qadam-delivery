import {z} from 'zod';
import {database,transaction} from './db';
import {AppError} from './errors';
import {lockCouriers,requireCourierAccess,lockedOrder,parseTrust,assertVersion} from './trust-core';
import {locationConsentVersion,type LocationStreamStatus} from './location-consent';
import type {TelegramLocationInput} from './telegram-location-input';
import type {User} from './types';
import type {Db} from './telegram-outbox';
import {persistOrderLocation} from './locations';

const active=['ACCEPTED','PICKED_UP','IN_TRANSIT'];
const schema=z.union([
  z.object({action:z.literal('START'),requestKey:z.uuid(),expectedVersion:z.number().int().min(0),consentVersion:z.literal(locationConsentVersion)}).strict(),
  z.object({action:z.literal('STOP'),streamId:z.uuid(),requestKey:z.uuid().optional(),expectedVersion:z.number().int().min(0)}).strict(),
]);
export const liveLocationEnabled=()=>process.env.TELEGRAM_LIVE_LOCATION_ENABLED==='true';
export const liveLocationPilotOnly=()=>process.env.TELEGRAM_LIVE_LOCATION_PILOT_ONLY!=='false';
async function canPilot(db:Db,id:string){
  if(!liveLocationPilotOnly())return true;
  const ids=(process.env.TELEGRAM_LIVE_LOCATION_PILOT_IDS??'').split(',').filter(Boolean);
  return !!(await db.query(`SELECT 1 FROM qadam.telegram_identities t WHERE t.user_id=$1 AND (t.telegram_user_id::text=ANY($2::text[]) OR EXISTS(SELECT 1 FROM qadam.administrators a WHERE a.user_id=t.user_id))`,[id,ids])).rowCount;
}
async function expireStreams(db:Db,id:string){
  await db.query(`UPDATE qadam.order_location_streams SET state='STOPPED',stopped_at=clock_timestamp()
    WHERE courier_id=$1 AND state IN ('WAITING','LIVE') AND (expires_at<=clock_timestamp()
      OR (state='WAITING' AND created_at<clock_timestamp()-interval '5 minutes'))`,[id]);
}
export async function streamStatus(actor:User,id:string):Promise<LocationStreamStatus>{
  return transaction(async db=>{
    await lockCouriers(db,[actor.id]);await requireCourierAccess(db,actor.id);const order=await lockedOrder(db,id);
    if(order.courier_id!==actor.id)throw new AppError(403,'Этот заказ вам не назначен.');
    await expireStreams(db,actor.id);
    const row=(await db.query(`SELECT id,state,expires_at AS "expiresAt",last_message_at AS "updatedAt",last_received_at AS "receivedAt",update_count AS "updateCount"
      FROM qadam.order_location_streams WHERE order_id=$1 AND courier_id=$2 AND assignment_version=$3 ORDER BY created_at DESC LIMIT 1`,[id,actor.id,order.assignment_version])).rows[0];
    return{enabled:liveLocationEnabled(),pilotOnly:liveLocationPilotOnly(),allowed:liveLocationEnabled()&&await canPilot(db,actor.id),stream:row??null};
  });
}
export async function changeLocationStream(actor:User,id:string,input:unknown){
  const data=parseTrust(schema,input);
  await transaction(async db=>{
    await lockCouriers(db,[actor.id]);await requireCourierAccess(db,actor.id);const order=await lockedOrder(db,id);
    if(order.courier_id!==actor.id)throw new AppError(403,'Этот заказ вам не назначен.');assertVersion(order,data.expectedVersion);
    if(data.action==='STOP'){
      await db.query("UPDATE qadam.order_location_streams SET state='STOPPED',stopped_at=clock_timestamp() WHERE id=$1 AND order_id=$2 AND courier_id=$3",[data.streamId,id,actor.id]);return;
    }
    if(!liveLocationEnabled()||!await canPilot(db,actor.id))throw new AppError(403,'Трансляция пока доступна только согласованным курьерским аккаунтам для закрытой проверки.');
    if(!active.includes(order.status))throw new AppError(409,'Подключение доступно только для активной доставки.');
    const identity=(await db.query('SELECT telegram_user_id::text AS id FROM qadam.telegram_identities WHERE user_id=$1',[actor.id])).rows[0];
    if(!identity)throw new AppError(409,'Откройте Qadam из Telegram.');
    const shift=(await db.query(`SELECT s.updated_at+interval '8 hours' AS expires FROM qadam.courier_status s
      JOIN qadam.courier_presence p ON p.user_id=s.user_id WHERE s.user_id=$1 AND s.online AND s.updated_at>clock_timestamp()-interval '8 hours'
      AND p.sharing AND p.auto_consent_version=$2`,[actor.id,locationConsentVersion])).rows[0];
    if(!shift)throw new AppError(409,'Сначала включите режим «Я на линии».');
    await expireStreams(db,actor.id);
    const previous=await db.query('SELECT id FROM qadam.order_location_streams WHERE order_id=$1 AND courier_id=$2 AND request_key=$3',[id,actor.id,data.requestKey]);
    if(previous.rowCount)return; // A lost START response never opens a second session, including after STOP.
    const current=await db.query("SELECT 1 FROM qadam.order_location_streams WHERE courier_id=$1 AND state IN ('WAITING','LIVE')",[actor.id]);
    if(current.rowCount)throw new AppError(409,'Уже подключена другая сессия. Сначала остановите её.');
    await db.query(`INSERT INTO qadam.order_location_streams(order_id,courier_id,assignment_version,request_key,telegram_user_id,consent_version,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,least($7::timestamptz,clock_timestamp()+interval '8 hours'))`,[id,actor.id,order.assignment_version,data.requestKey,identity.id,locationConsentVersion,shift.expires]);
  });
  return streamStatus(actor,id);
}

/** Runs only after webhook-secret verification. No raw message/GPS history is queued. */
export async function receiveLiveLocation(point:TelegramLocationInput){
  if(!liveLocationEnabled())return;
  await transaction(async db=>{
    const identity=(await db.query(`SELECT u.id FROM qadam.telegram_identities t JOIN qadam.users u ON u.id=t.user_id WHERE t.telegram_user_id=$1 AND u.active`,[point.telegramId])).rows[0];
    if(!identity)return;
    await lockCouriers(db,[identity.id]);
    // Blocked/non-courier events are expected input, not a webhook retry condition.
    try{await requireCourierAccess(db,identity.id);}catch(e){if(e instanceof AppError)return;throw e;}
    const found=(await db.query("SELECT order_id FROM qadam.order_location_streams WHERE courier_id=$1 AND state IN ('WAITING','LIVE')",[identity.id])).rows[0];
    if(!found)return;
    const order=await lockedOrder(db,found.order_id);
    const session=(await db.query("SELECT * FROM qadam.order_location_streams WHERE courier_id=$1 AND state IN ('WAITING','LIVE') FOR UPDATE",[identity.id])).rows[0];
    if(!session)return;
    const eligible=(await db.query(`SELECT 1 FROM qadam.courier_status s JOIN qadam.courier_presence p ON p.user_id=s.user_id
      WHERE s.user_id=$1 AND s.online AND s.updated_at>clock_timestamp()-interval '8 hours' AND p.sharing
      AND p.auto_consent_version=$2`,[identity.id,locationConsentVersion])).rowCount;
    if(!eligible||!await canPilot(db,identity.id)||order.courier_id!==identity.id||order.assignment_version!==session.assignment_version||!active.includes(order.status)
      ||new Date(session.expires_at).getTime()<=Date.now()||(session.state==='WAITING'&&Date.now()-new Date(session.created_at).getTime()>300000)){
      await db.query("UPDATE qadam.order_location_streams SET state='STOPPED',stopped_at=clock_timestamp() WHERE id=$1",[session.id]);return;
    }
    if(point.updateId<=Number(session.last_update_id))return;
    if(session.state==='WAITING'){
      if(point.edited||point.state!=='LIVE'||Date.parse(point.sentAt)<new Date(session.created_at).getTime()-5000)return;
      if((await db.query('SELECT 1 FROM qadam.order_location_streams WHERE courier_id=$1 AND message_id=$2 AND id<>$3',[identity.id,point.messageId,session.id])).rowCount)return;
    }else if(Number(session.message_id)!==point.messageId||!point.edited)return;
    if(session.last_message_at&&Date.parse(point.updatedAt)<new Date(session.last_message_at).getTime())return;
    if(point.state!=='LIVE'){
      await db.query("UPDATE qadam.order_location_streams SET state='STOPPED',stopped_at=clock_timestamp(),last_update_id=$2 WHERE id=$1",[session.id,point.updateId]);return;
    }
    await db.query(`UPDATE qadam.order_location_streams SET state='LIVE',message_id=$2,last_update_id=$3,
      last_message_at=$4,last_received_at=clock_timestamp(),update_count=update_count+1,expires_at=least(expires_at,$5::timestamptz) WHERE id=$1`,[session.id,point.messageId,point.updateId,point.updatedAt,point.expiresAt]);
    await persistOrderLocation(db,order.id,identity.id,{latitude:point.latitude,longitude:point.longitude,accuracy:point.accuracy,capturedAt:point.updatedAt},'TELEGRAM_LIVE');
  });
}
