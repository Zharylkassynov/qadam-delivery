import {z} from 'zod';
import {transaction} from './db';
import {AppError} from './errors';
import type {User} from './types';
import {lockedOrder,parseTrust} from './trust-core';
const schema=z.object({score:z.number().int().min(1).max(5),comment:z.string().trim().max(500).default('')}).strict();
export async function rateOrder(actor:User,id:string,input:unknown){
  const data=parseTrust(schema,input);
  return transaction(async db=>{
    const order=await lockedOrder(db,id);
    if(order.customer_id!==actor.id)throw new AppError(403,'Оценить можно только свою доставку.');
    if(order.status!=='DELIVERED')throw new AppError(409,'Оценка доступна после завершения доставки.');
    const old=(await db.query('SELECT score,comment FROM qadam.order_ratings WHERE order_id=$1',[id])).rows[0];
    if(old){if(old.score!==data.score||old.comment!==data.comment)throw new AppError(409,'Оценка уже отправлена. Для исправления напишите команде Qadam.');return{ok:true};}
    await db.query('INSERT INTO qadam.order_ratings(order_id,author_id,score,comment) VALUES($1,$2,$3,$4)',[id,actor.id,data.score,data.comment]);return{ok:true};
  });
}
