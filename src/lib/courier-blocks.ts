import {z} from 'zod';
import {database,transaction} from './db';
import {AppError} from './errors';
import {requireAdministrator} from './administrators';
import {lockCouriers,parseTrust,reasonSchema} from './trust-core';
import type {User} from './types';
import {enqueueBotMessage} from './telegram-outbox';
const schema=z.object({requestKey:z.uuid(),blocked:z.boolean(),expectedBlocked:z.boolean(),reason:reasonSchema}).strict();
export async function courierBlockState(actor:User,id=actor.id){
  if(!z.uuid().safeParse(id).success)throw new AppError(400,'Некорректный идентификатор курьера.');
  const db=database();if(id!==actor.id)await requireAdministrator(db,actor);
  const row=(await db.query('SELECT blocked,reason,updated_at AS "updatedAt" FROM qadam.courier_blocks WHERE user_id=$1',[id])).rows[0];
  return{blocked:row?.blocked??false,...(id!==actor.id?{reason:row?.reason??'',updatedAt:row?.updatedAt??null}:{})};
}
export async function changeCourierBlock(actor:User,id:string,input:unknown){
  if(!z.uuid().safeParse(id).success)throw new AppError(400,'Некорректный идентификатор курьера.');
  z.uuid().parse(id);const data=parseTrust(schema,input);
  return transaction(async db=>{
    await requireAdministrator(db,actor);await lockCouriers(db,[id]);
    if(id===actor.id&&data.blocked)throw new AppError(409,'Нельзя приостановить собственный курьерский доступ.');
    const member=await db.query("SELECT 1 FROM qadam.users u WHERE u.id=$1 AND (u.role='COURIER' OR EXISTS(SELECT 1 FROM qadam.courier_applications a WHERE a.user_id=u.id AND a.status='APPROVED'))",[id]);
    if(!member.rowCount)throw new AppError(404,'Одобренный курьер не найден.');
    const previous=(await db.query('SELECT blocked,reason FROM qadam.courier_block_events WHERE user_id=$1 AND actor_id=$2 AND request_key=$3',[id,actor.id,data.requestKey])).rows[0];
    if(previous){if(previous.blocked!==data.blocked||previous.reason!==data.reason)throw new AppError(409,'Этот запрос уже использован с другой причиной.');return{ok:true};}
    const current=(await db.query('SELECT blocked FROM qadam.courier_blocks WHERE user_id=$1',[id])).rows[0]?.blocked??false;
    if(current!==data.expectedBlocked)throw new AppError(409,'Доступ уже изменился. Обновите сведения.');
    if(current===data.blocked)throw new AppError(409,'Доступ уже находится в выбранном состоянии.');
    await db.query('INSERT INTO qadam.courier_blocks(user_id,blocked,reason,actor_id) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET blocked=excluded.blocked,reason=excluded.reason,actor_id=excluded.actor_id,updated_at=clock_timestamp()',[id,data.blocked,data.reason,actor.id]);
    await db.query('INSERT INTO qadam.courier_block_events(user_id,actor_id,request_key,blocked,reason) VALUES($1,$2,$3,$4,$5)',[id,actor.id,data.requestKey,data.blocked,data.reason]);
    if(data.blocked){
      await db.query('UPDATE qadam.courier_status SET online=false,updated_at=clock_timestamp() WHERE user_id=$1',[id]);
      await db.query('UPDATE qadam.courier_presence SET sharing=false,latitude=NULL,longitude=NULL,accuracy=NULL,captured_at=NULL,received_at=NULL WHERE user_id=$1',[id]);
    }
    const identity=(await db.query('SELECT telegram_user_id::text AS chat FROM qadam.telegram_identities WHERE user_id=$1 AND allows_write AND bot_blocked_at IS NULL',[id])).rows[0];
    if(identity)await enqueueBotMessage(db,`courier:${id}:block:${data.requestKey}`,identity.chat,{chat_id:identity.chat,text:data.blocked?'Курьерский доступ приостановлен. По активным доставкам и вопросам решения напишите @zharlkssnv. Личный клиентский аккаунт сохраняется.':'Курьерский доступ восстановлен. Можно открыть Qadam и включить смену.'});
    return{ok:true};
  });
}
