import {database} from './db';
import type {User} from './types';
import {privateOrder} from './trust-core';
import {handoffsEnabled} from './handoff-settings';
import {handoffInfo} from './order-handoffs';
export async function orderTrustInfo(actor:User,id:string){
  const db=database(),order=await privateOrder(db,actor,id);
  const admin=!!(await db.query('SELECT 1 FROM qadam.administrators WHERE user_id=$1',[actor.id])).rowCount;
  const photo=(await db.query("SELECT state,expires_at AS \"expiresAt\",expires_at<=clock_timestamp() AS expired FROM qadam.order_photos WHERE order_id=$1 AND assignment_version=$2 AND courier_id=$3 AND state IN ('READY','EXPIRED') ORDER BY created_at DESC,id DESC LIMIT 1",[id,order.assignment_version,order.courier_id])).rows[0];
  const code=(await db.query('SELECT attempts FROM qadam.order_delivery_codes WHERE order_id=$1',[id])).rows[0];
  const rating=order.customer_id===actor.id||admin?(await db.query('SELECT score,comment,created_at AS "createdAt" FROM qadam.order_ratings WHERE order_id=$1',[id])).rows[0]??null:undefined;
  return{photoRequired:order.photo_required,codeRequired:order.code_required,assignmentVersion:order.assignment_version,
    photo:photo?{state:photo.expired?'EXPIRED':'READY',expiresAt:photo.expiresAt}:null,attemptsRemaining:code?5-code.attempts:null,
    ...(rating!==undefined?{rating}:{}),...(handoffsEnabled()?{handoff:await handoffInfo(db,order)}:{}),canResetCode:order.code_required&&(order.customer_id===actor.id||admin)&&!['DELIVERED','CANCELLED'].includes(order.status)};
}
