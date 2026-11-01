import {createCipheriv,createDecipheriv,createHmac,randomBytes,randomInt,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {database,transaction} from './db';
import {AppError} from './errors';
import type {Db} from './telegram-outbox';
import type {User} from './types';
import {codeKey} from './proof-settings';
import {requireAdministrator} from './administrators';
import {actionFields,reasonSchema,parseTrust,privateOrder,lockedOrder,priorAction,saveAction,trustEvent,assertVersion} from './trust-core';

const key=(domain:string)=>createHmac('sha256',codeKey()).update(domain).digest();
const verifier=(id:string,version:number,code:string)=>createHmac('sha256',key('qadam-code-verifier-v1')).update(`${id}:${version}:${code}`).digest('hex');
export const completionFingerprint=(value:unknown)=>createHmac('sha256',key('qadam-completion-request-v1')).update(JSON.stringify(value)).digest('hex');
function sealed(id:string,version:number,code:string){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key('qadam-code-encryption-v1'),iv);
  cipher.setAAD(Buffer.from(`${id}:${version}`));const bytes=Buffer.concat([cipher.update(code,'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64');
}
function opened(id:string,version:number,value:string){
  try{const raw=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',key('qadam-code-encryption-v1'),raw.subarray(0,12));cipher.setAAD(Buffer.from(`${id}:${version}`));cipher.setAuthTag(raw.subarray(12,28));const code=Buffer.concat([cipher.update(raw.subarray(28)),cipher.final()]).toString('utf8');if(!/^\d{4}$/.test(code))throw new Error();return code;}catch{throw new AppError(503,'Код сейчас недоступен. Обратитесь к команде.');}
}
export async function initialiseCode(db:Db,id:string){
  const code=String(randomInt(10000)).padStart(4,'0');
  await db.query('INSERT INTO qadam.order_delivery_codes(order_id,verifier,encrypted_code) VALUES($1,$2,$3)',[id,verifier(id,1,code),sealed(id,1,code)]);
}
export async function rotateCode(db:Db,id:string){
  const row=(await db.query('SELECT version,verifier FROM qadam.order_delivery_codes WHERE order_id=$1 FOR UPDATE',[id])).rows[0];
  if(!row)return;
  const version=row.version+1;let code:string;
  do{code=String(randomInt(10000)).padStart(4,'0');}while(verifier(id,row.version,code)===row.verifier);
  await db.query('UPDATE qadam.order_delivery_codes SET version=$2,verifier=$3,encrypted_code=$4,attempts=0,reset_at=clock_timestamp() WHERE order_id=$1',[id,version,verifier(id,version,code),sealed(id,version,code)]);
}
export async function viewCode(actor:User,id:string){
  const db=database(),order=await privateOrder(db,actor,id);
  if(order.customer_id!==actor.id)throw new AppError(403,'Код доступен только отправителю.');
  if(!order.code_required||['DELIVERED','CANCELLED'].includes(order.status))throw new AppError(409,'Действующий код для этого заказа не требуется.');
  const row=(await db.query('SELECT version,encrypted_code,attempts,reset_at FROM qadam.order_delivery_codes WHERE order_id=$1',[id])).rows[0];
  if(!row)throw new AppError(503,'Код временно недоступен.');
  return{code:opened(id,row.version,row.encrypted_code),version:row.version,attemptsRemaining:5-row.attempts,resetAt:row.reset_at};
}
const resetSchema=z.object({...actionFields,reason:reasonSchema}).strict();
export async function resetCode(actor:User,id:string,input:unknown){
  const data=parseTrust(resetSchema,input);const hash=completionFingerprint(data);
  return transaction(async db=>{
    const order=await lockedOrder(db,id);
    if(order.customer_id!==actor.id)await requireAdministrator(db,actor);
    const previous=await priorAction(db,actor,id,data.requestKey,'CODE_RESET',hash);if(previous)return previous;
    assertVersion(order,data.expectedVersion);
    if(!order.code_required||['DELIVERED','CANCELLED'].includes(order.status))throw new AppError(409,'Код этого заказа изменить нельзя.');
    const row=(await db.query("SELECT reset_at>clock_timestamp()-interval '1 minute' AS recent,CASE WHEN reset_window_start<clock_timestamp()-interval '1 hour' THEN 0 ELSE reset_count END AS resets FROM qadam.order_delivery_codes WHERE order_id=$1 FOR UPDATE",[id])).rows[0];
    if(!row)throw new AppError(503,'Код временно недоступен.');
    if(row.resets>=3||row.recent)throw new AppError(429,'Код недавно обновлялся. Посмотрите действующий код или повторите позже.');
    await db.query("UPDATE qadam.order_delivery_codes SET reset_count=$2+1,reset_window_start=CASE WHEN reset_window_start<clock_timestamp()-interval '1 hour' THEN clock_timestamp() ELSE reset_window_start END WHERE order_id=$1",[id,row.resets]);
    await rotateCode(db,id);await trustEvent(db,order,actor,'CODE_RESET',data.reason);
    return saveAction(db,actor,id,data.requestKey,'CODE_RESET',hash,{ok:true});
  });
}
// Caller owns the order lock; failed attempts must be committed before returning an HTTP error.
export async function checkDeliveryCode(db:Db,id:string,code:string|undefined){
  const row=(await db.query('SELECT version,verifier,attempts FROM qadam.order_delivery_codes WHERE order_id=$1 FOR UPDATE',[id])).rows[0];
  if(!row)throw new AppError(503,'Код временно недоступен.');
  if(row.attempts>=5)return{ok:false,status:423,message:'Попытки закончились. Попросите отправителя выпустить новый код.'};
  if(!code||!/^\d{4}$/.test(code))throw new AppError(400,'Введите четырёхзначный код получателя.');
  const actual=Buffer.from(verifier(id,row.version,code),'hex'),expected=Buffer.from(row.verifier,'hex');
  if(actual.length===expected.length&&timingSafeEqual(actual,expected))return{ok:true};
  await db.query('UPDATE qadam.order_delivery_codes SET attempts=attempts+1 WHERE order_id=$1',[id]);
  const left=4-row.attempts;
  return{ok:false,status:left===0?423:400,message:left===0?'Попытки закончились. Попросите отправителя выпустить новый код.':`Код не подошёл. Осталось попыток: ${left}. Уточните его у получателя.`};
}
