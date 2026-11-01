import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Db} from './telegram-outbox';
import type {Status,User} from './types';
import {AppError} from './errors';

export const notBlocked=(alias='u')=>`NOT EXISTS(SELECT 1 FROM qadam.courier_blocks cb WHERE cb.user_id=${alias}.id AND cb.blocked)`;
export async function lockCouriers(db:Db,ids:(string|null|undefined)[]){
  for(const id of [...new Set(ids.filter((id):id is string=>!!id))].sort())await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`courier-assignment:${id}`]);
}
export async function requireCourierAccess(db:Db,id:string){
  const row=await db.query(`SELECT 1 FROM qadam.users u WHERE u.id=$1 AND u.active AND ${notBlocked()}
    AND (u.role='COURIER' OR EXISTS(SELECT 1 FROM qadam.courier_applications a WHERE a.user_id=u.id AND a.status='APPROVED'))`,[id]);
  if(!row.rowCount)throw new AppError(403,'Курьерский доступ недоступен. Обратитесь к команде Qadam.');
}
export type TrustOrder={id:string;number:string;customer_id:string;courier_id:string|null;status:Status;photo_required:boolean;code_required:boolean;assignment_version:number;price_kzt:number|null;deliver_before:Date|null};
export async function lockedOrder(db:Db,id:string):Promise<TrustOrder>{
  if(!z.uuid().safeParse(id).success)throw new AppError(400,'Некорректный номер заказа.');
  const row=(await db.query('SELECT id,number::text,customer_id,courier_id,status,photo_required,code_required,assignment_version,price_kzt,deliver_before FROM qadam.orders WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!row)throw new AppError(404,'Заказ не найден.');return row;
}
export async function privateOrder(db:Db,actor:User,id:string):Promise<TrustOrder>{
  if(!z.uuid().safeParse(id).success)throw new AppError(400,'Некорректный номер заказа.');
  const row=(await db.query(`SELECT o.id,o.number::text,o.customer_id,o.courier_id,o.status,o.photo_required,o.code_required,o.assignment_version,o.price_kzt,o.deliver_before,
    EXISTS(SELECT 1 FROM qadam.administrators a JOIN qadam.users u ON u.id=a.user_id WHERE a.user_id=$2 AND u.active) AS admin
    FROM qadam.orders o JOIN qadam.users viewer ON viewer.id=$2 AND viewer.active WHERE o.id=$1`,[id,actor.id])).rows[0];
  if(!row)throw new AppError(404,'Заказ недоступен.');
  if(row.customer_id!==actor.id&&!row.admin){
    if(row.courier_id!==actor.id)throw new AppError(404,'Заказ недоступен.');
    await requireCourierAccess(db,actor.id);
  }
  return row;
}
export function parseTrust<T>(schema:z.ZodType<T>,input:unknown):T{
  const data=schema.safeParse(input);if(!data.success)throw new AppError(400,'Проверьте причину, подтверждения и формат данных.');return data.data;
}
export const actionFields={requestKey:z.uuid(),expectedVersion:z.number().int().min(0)};
export const reasonSchema=z.string().trim().min(5).max(500).refine(value=>Array.from(value).length>=5);
export type ActionResult={ok:boolean;status?:number;message?:string};
export function fingerprint(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
export async function priorAction(db:Db,actor:User,id:string,key:string,kind:string,hash:string):Promise<ActionResult|null>{
  const old=(await db.query('SELECT kind,fingerprint,result FROM qadam.order_actions WHERE order_id=$1 AND actor_id=$2 AND request_key=$3',[id,actor.id,key])).rows[0];
  if(!old)return null;
  if(old.kind!==kind||old.fingerprint!==hash)throw new AppError(409,'Этот запрос уже использован с другими условиями. Обновите заказ.');
  return old.result;
}
export async function saveAction(db:Db,actor:User,id:string,key:string,kind:string,hash:string,result:ActionResult){
  await db.query('INSERT INTO qadam.order_actions(order_id,actor_id,request_key,kind,fingerprint,result) VALUES($1,$2,$3,$4,$5,$6)',[id,actor.id,key,kind,hash,JSON.stringify(result)]);return result;
}
export function assertVersion(order:TrustOrder,version:number){if(order.assignment_version!==version)throw new AppError(409,'Назначение уже изменилось. Обновите заказ и проверьте действие.');}
export async function trustEvent(db:Db,order:TrustOrder,actor:User,kind:string,reason:string|null=null,previous:string|null=null,next:string|null=null){
  await db.query('INSERT INTO qadam.order_events(order_id,actor_id,status,kind,reason,previous_courier_id,next_courier_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[order.id,actor.id,order.status,kind,reason,previous,next]);
}
