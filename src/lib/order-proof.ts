import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {database,transaction} from './db';
import {AppError} from './errors';
import type {User} from './types';
import {photoMaxBytes,photoMaxSide,storageChat} from './proof-settings';
import {telegramPhotoStorage,type PhotoStorage} from './telegram-storage';
import {lockCouriers,requireCourierAccess,lockedOrder,privateOrder,parseTrust,actionFields,priorAction,saveAction,assertVersion,trustEvent,type ActionResult} from './trust-core';
import {checkDeliveryCode,completionFingerprint} from './order-codes';
import {getOrder} from './orders';
import {queueCustomerOrderStatus} from './order-notifications';
import {enqueueBotMessage} from './telegram-outbox';
import {handoffsEnabled} from './handoff-settings';

const uploadSchema=z.object({...actionFields,image:z.string().min(4).max(1400000)}).strict();
const completionSchema=z.object({...actionFields,handedOver:z.literal(true),code:z.string().regex(/^\d{4}$/).optional()}).strict();
export async function normalisePhoto(input:Buffer){
  if(input.length>photoMaxBytes||input.length<8)throw new AppError(413,'Фото должно быть не больше 1 МБ после сжатия.');
  if(!input.subarray(0,3).equals(Buffer.from([255,216,255]))&&!input.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new AppError(400,'Выберите фотографию JPEG или PNG.');
  try{
    const result=await sharp(input,{failOn:'error',limitInputPixels:photoMaxSide*photoMaxSide}).rotate().resize({width:photoMaxSide,height:photoMaxSide,fit:'inside',withoutEnlargement:true}).jpeg({quality:82,mozjpeg:true}).toBuffer({resolveWithObject:true});
    if(result.data.length>photoMaxBytes)throw new Error();
    return{bytes:result.data,width:result.info.width,height:result.info.height};
  }catch{throw new AppError(400,'Не удалось прочитать фото. Выберите другой снимок размером до 1600 пикселей.');}
}
export async function uploadOrderPhoto(actor:User,id:string,input:unknown,storage:PhotoStorage=telegramPhotoStorage){
  await requireCourierAccess(database(),actor.id);
  const visible=await privateOrder(database(),actor,id);
  if(visible.courier_id!==actor.id)throw new AppError(403,'Этот заказ вам не назначен.');
  const data=parseTrust(uploadSchema,input);if(!/^[A-Za-z0-9+/]+={0,2}$/.test(data.image))throw new AppError(400,'Некорректный формат фото.');
  const bytes=Buffer.from(data.image,'base64');if(bytes.toString('base64')!==data.image)throw new AppError(400,'Некорректный формат фото.');
  const image=await normalisePhoto(bytes),hash=createHash('sha256').update(image.bytes).digest('hex');
  const reservation=await transaction(async db=>{
    await lockCouriers(db,[actor.id]);await requireCourierAccess(db,actor.id);const order=await lockedOrder(db,id);
    if(order.courier_id!==actor.id)throw new AppError(403,'Этот заказ вам не назначен.');assertVersion(order,data.expectedVersion);
    if(order.status!=='IN_TRANSIT')throw new AppError(409,'Фото вручения доступно только для доставки в пути.');
    if(!order.photo_required)throw new AppError(409,'Для этого заказа фото не требуется.');
    const old=(await db.query('SELECT * FROM qadam.order_photos WHERE order_id=$1 AND assignment_version=$2 AND request_key=$3 FOR UPDATE',[id,order.assignment_version,data.requestKey])).rows[0];
    if(old&&old.content_hash!==hash)throw new AppError(409,'Этот запрос уже использован для другого фото.');
    if(old?.state==='RETIRED')throw new AppError(409,'Условия передачи изменились. Добавьте новое фото.');
    if(old?.state==='READY')return{done:true,id:old.id,number:order.number,routeVersion:order.route_version};
    if(old?.state==='UPLOADING'&&new Date(old.lease_until).getTime()>Date.now())throw new AppError(409,'Фото ещё сохраняется. Подождите немного и повторите.');
    await db.query("UPDATE qadam.order_photos SET state='FAILED' WHERE order_id=$1 AND state='UPLOADING' AND lease_until<=clock_timestamp()",[id]);
    const pending=await db.query("SELECT 1 FROM qadam.order_photos WHERE order_id=$1 AND state='UPLOADING' AND lease_until>clock_timestamp()",[id]);
    if(pending.rowCount)throw new AppError(409,'Другое фото ещё сохраняется. Дождитесь результата.');
    const count=(await db.query("SELECT coalesce(sum(upload_attempts),0)::int AS count FROM qadam.order_photos WHERE order_id=$1 AND lease_until>clock_timestamp()-interval '1 hour'",[id])).rows[0].count;
    if(count>=12)throw new AppError(429,'Слишком много загрузок. Подождите или обратитесь к команде.');
    if(old){await db.query("UPDATE qadam.order_photos SET state='UPLOADING',upload_attempts=CASE WHEN lease_until<clock_timestamp()-interval '1 hour' THEN 1 ELSE upload_attempts+1 END,lease_until=clock_timestamp()+interval '1 minute' WHERE id=$1",[old.id]);return{done:false,id:old.id,number:order.number,routeVersion:order.route_version};}
    const saved=await db.query(`INSERT INTO qadam.order_photos(order_id,courier_id,assignment_version,request_key,content_hash,chat_id,byte_size,width,height)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[id,actor.id,order.assignment_version,data.requestKey,hash,storageChat(),image.bytes.length,image.width,image.height]);
    return{done:false,id:saved.rows[0].id,number:order.number,routeVersion:order.route_version};
  });
  if(reservation.done)return{ok:true};
  try{
    // No database connection is held during provider I/O.
    const stored=await storage.upload(image.bytes,reservation.number);
    if(stored.chatId!==storageChat()||!stored.fileId||stored.fileId.length>512||!Number.isSafeInteger(stored.messageId)||stored.messageId<=0)throw new AppError(503,'Фото не сохранилось. Повторите попытку.');
    await transaction(async db=>{
      await lockCouriers(db,[actor.id]);await requireCourierAccess(db,actor.id);const order=await lockedOrder(db,id);
      if(order.courier_id!==actor.id||order.assignment_version!==data.expectedVersion||order.route_version!==reservation.routeVersion||order.status!=='IN_TRANSIT')throw new AppError(409,'Назначение, адрес или статус изменились. Обновите заказ.');
      await db.query("UPDATE qadam.order_photos SET state='RETIRED' WHERE order_id=$1 AND assignment_version=$2 AND state='READY' AND id<>$3",[id,order.assignment_version,reservation.id]);
      await db.query("UPDATE qadam.order_photos SET state='READY',file_id=$2,message_id=$3,lease_until=clock_timestamp(),expires_at=clock_timestamp()+interval '30 days' WHERE id=$1 AND state='UPLOADING'",[reservation.id,stored.fileId,stored.messageId]);
    });
    return{ok:true};
  }catch(error){await database().query("UPDATE qadam.order_photos SET state='FAILED',file_id=NULL WHERE id=$1 AND state='UPLOADING'",[reservation.id]);if(error instanceof AppError)throw error;throw new AppError(503,'Фото не сохранилось. Повторите попытку.');}
}
export async function readOrderPhoto(actor:User,id:string,storage:PhotoStorage=telegramPhotoStorage){
  const db=database(),order=await privateOrder(db,actor,id);
  const row=(await db.query("SELECT id,file_id,expires_at>clock_timestamp() AS available FROM qadam.order_photos WHERE order_id=$1 AND assignment_version=$2 AND courier_id=$3 AND state='READY' ORDER BY created_at DESC,id DESC LIMIT 1",[id,order.assignment_version,order.courier_id])).rows[0];
  if(!row?.file_id||!row.available)throw new AppError(410,'Фото больше не доступно. История доставки сохранена.');
  const image=await normalisePhoto(await storage.download(row.file_id));
  // Recheck after provider I/O: a former courier cannot finish an in-flight download after reassignment.
  const current=await privateOrder(db,actor,id);if(current.assignment_version!==order.assignment_version||current.route_version!==order.route_version)throw new AppError(409,'Назначение или адрес изменились. Обновите заказ.');
  if(!(await db.query("SELECT 1 FROM qadam.order_photos WHERE id=$1 AND state='READY' AND file_id=$2 AND expires_at>clock_timestamp()",[row.id,row.file_id])).rowCount)throw new AppError(410,'Фото больше не доступно. История доставки сохранена.');
  return image.bytes;
}
export async function completeOrder(actor:User,id:string,input:unknown){
  if(handoffsEnabled()){
    // All callers of the old endpoint use the same mandatory dropoff guard.
    const {confirmHandoff}=await import('./order-handoffs');
    const parsed=z.object({...actionFields,expectedRouteVersion:z.number().int().min(0),handedOver:z.literal(true),code:z.string().regex(/^\d{6}$/)}).strict().safeParse(input);
    if(!parsed.success)throw new AppError(400,'Откройте Qadam заново и введите код из 6 цифр.');
    return confirmHandoff(actor,id,{...parsed.data,stage:'DROPOFF'});
  }
  const data=parseTrust(completionSchema,input);
  // Legacy orders with no code must not require a configured encryption key.
  const hash=data.code?completionFingerprint(data):createHash('sha256').update(JSON.stringify(data)).digest('hex');
  const result:ActionResult=await transaction(async db=>{
    await lockCouriers(db,[actor.id]);await requireCourierAccess(db,actor.id);const order=await lockedOrder(db,id);
    if(order.courier_id!==actor.id)throw new AppError(403,'Этот заказ вам не назначен.');
    const old=await priorAction(db,actor,id,data.requestKey,'COMPLETE',hash);if(old)return old;
    assertVersion(order,data.expectedVersion);
    if(order.status==='DELIVERED')return saveAction(db,actor,id,data.requestKey,'COMPLETE',hash,{ok:true});
    if(order.status!=='IN_TRANSIT')throw new AppError(409,'Сначала начните доставку.');
    const photo=(await db.query("SELECT id,file_id FROM qadam.order_photos WHERE order_id=$1 AND courier_id=$2 AND assignment_version=$3 AND state='READY' AND expires_at>clock_timestamp() ORDER BY created_at DESC,id DESC LIMIT 1",[id,actor.id,order.assignment_version])).rows[0];
    if(order.photo_required&&!photo)throw new AppError(409,'Сначала сохраните фото вручения.');
    if(order.code_required){const codeResult=await checkDeliveryCode(db,id,data.code);if(!codeResult.ok)return saveAction(db,actor,id,data.requestKey,'COMPLETE',hash,codeResult);}
    await db.query("UPDATE qadam.orders SET status='DELIVERED',updated_at=clock_timestamp() WHERE id=$1",[id]);
    await trustEvent(db,{...order,status:'DELIVERED'},actor,'STATUS');await queueCustomerOrderStatus(db,id,'DELIVERED');
    if(photo){
      const receiver=(await db.query('SELECT telegram_user_id::text AS chat FROM qadam.telegram_identities WHERE user_id=$1 AND allows_write AND bot_blocked_at IS NULL',[order.customer_id])).rows[0];
      if(receiver)await enqueueBotMessage(db,`order:${id}:proof:${photo.id}`,receiver.chat,{chat_id:receiver.chat,photo:photo.file_id,caption:`Фото вручения QD-${order.number.padStart(4,'0')}`},'sendPhoto',{orderId:id});
    }
    return saveAction(db,actor,id,data.requestKey,'COMPLETE',hash,{ok:true});
  });
  if(!result.ok)throw new AppError(result.status??400,result.message??'Код не подошёл.');
  return getOrder(actor,id);
}
export {expireOrderPhotos} from './photo-retention';
