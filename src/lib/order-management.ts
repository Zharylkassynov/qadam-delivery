import {z} from 'zod';
import {database,transaction} from './db';
import {AppError} from './errors';
import type {User,Status} from './types';
import {requireAdministrator} from './administrators';
import {actionFields,assertVersion,fingerprint,lockedOrder,lockCouriers,notBlocked,parseTrust,priorAction,reasonSchema,requireCourierAccess,saveAction,trustEvent} from './trust-core';
import {getOrder} from './orders';
import {rotateCode} from './order-codes';
import {closeAvailableOrders,queueAvailableOrder,queueCustomerOrderStatus} from './order-notifications';
import {enqueueBotMessage} from './telegram-outbox';
import {phoneProfile,requirePhone} from './user-profiles';

const releaseSchema=z.object({...actionFields,reason:reasonSchema,notPickedUp:z.literal(true)}).strict();
const manageSchema=z.object({...actionFields,expectedStatus:z.enum(['CREATED','SEARCHING_FOR_COURIER','ACCEPTED','PICKED_UP','IN_TRANSIT','DELIVERED','CANCELLED']),expectedCourierId:z.uuid().nullable(),reason:reasonSchema,action:z.enum(['ASSIGN','CANCEL']),courierId:z.uuid().optional(),custodyConfirmed:z.boolean().default(false)}).strict();

export async function releaseOrder(actor:User,id:string,input:unknown){
  const data=parseTrust(releaseSchema,input),hash=fingerprint(data);
  await transaction(async db=>{
    await lockCouriers(db,[actor.id]);await requireCourierAccess(db,actor.id);const order=await lockedOrder(db,id);
    const previous=await priorAction(db,actor,id,data.requestKey,'RELEASE',hash);if(previous)return;
    if(order.courier_id!==actor.id)throw new AppError(403,'Этот заказ вам не назначен.');assertVersion(order,data.expectedVersion);
    if(order.status!=='ACCEPTED')throw new AppError(409,'Отказ доступен только до забора посылки. Свяжитесь с командой.');
    await closeAvailableOrders(db,id,null);
    await db.query("UPDATE qadam.orders SET courier_id=NULL,courier_phone=NULL,status='SEARCHING_FOR_COURIER',assignment_version=assignment_version+1,alerted_at=NULL,updated_at=clock_timestamp() WHERE id=$1",[id]);
    await db.query('DELETE FROM qadam.courier_locations WHERE order_id=$1',[id]);await rotateCode(db,id);
    await trustEvent(db,{...order,status:'SEARCHING_FOR_COURIER'},actor,'RELEASE',data.reason,actor.id,null);
    await queueAvailableOrder(db,id);
    const receiver=(await db.query('SELECT telegram_user_id::text AS chat FROM qadam.telegram_identities WHERE user_id=$1 AND allows_write AND bot_blocked_at IS NULL',[order.customer_id])).rows[0];
    if(receiver)await enqueueBotMessage(db,`order:${id}:release:${data.requestKey}`,receiver.chat,{chat_id:receiver.chat,text:`QD-${order.number.padStart(4,'0')}: курьер отказался до забора. Ищем другого исполнителя.`},'sendMessage',{orderId:id});
    await saveAction(db,actor,id,data.requestKey,'RELEASE',hash,{ok:true});
  });
  // The former courier sees the redacted search result, never the previous contacts.
  return getOrder(actor,id);
}
export async function managementInfo(actor:User,id:string){
  const db=database();await requireAdministrator(db,actor);
  if(!z.string().uuid().safeParse(id).success)throw new AppError(400,'Некорректный номер заказа.');
  const order=(await db.query('SELECT id,price_kzt,customer_id,courier_id FROM qadam.orders WHERE id=$1',[id])).rows[0];if(!order)throw new AppError(404,'Заказ не найден.');
  const candidates=(await db.query(`SELECT u.id,u.name,a.transport,p.phone_verified AS "phoneVerified",EXISTS(SELECT 1 FROM qadam.orders busy WHERE busy.courier_id=u.id AND busy.status IN ('ACCEPTED','PICKED_UP','IN_TRANSIT') AND busy.id<>$1 AND ($2::boolean OR busy.price_kzt IS NOT NULL)) AS busy
    FROM qadam.users u LEFT JOIN qadam.courier_applications a ON a.user_id=u.id AND a.status='APPROVED'
    LEFT JOIN qadam.user_profiles p ON p.user_id=u.id WHERE u.active AND ${notBlocked()} AND (u.role='COURIER' OR a.id IS NOT NULL)
      AND u.id<>$3 AND u.id IS DISTINCT FROM $4::uuid
      AND ($2::boolean=false OR (a.transport='CAR' AND p.phone_verified)) ORDER BY u.name,u.id LIMIT 300`,[id,order.price_kzt!==null,order.customer_id,order.courier_id])).rows.filter(c=>!c.busy);
  const events=(await db.query(`SELECT e.id,e.kind,e.reason,e.status,e.created_at AS at,u.name AS actor,e.previous_courier_id AS "previousCourierId",e.next_courier_id AS "nextCourierId"
    FROM qadam.order_events e JOIN qadam.users u ON u.id=e.actor_id WHERE e.order_id=$1 ORDER BY e.id`,[id])).rows;
  return{candidates,events};
}
export async function manageOrder(actor:User,id:string,input:unknown){
  const data=parseTrust(manageSchema,input),hash=fingerprint(data);
  await transaction(async db=>{
    await requireAdministrator(db,actor);
    // The expected assignment is a precondition, never an authority to lock/change arbitrary orders.
    await lockCouriers(db,[data.expectedCourierId,data.courierId]);const order=await lockedOrder(db,id);
    const old=await priorAction(db,actor,id,data.requestKey,data.action,hash);if(old)return;
    assertVersion(order,data.expectedVersion);
    if(order.status!==data.expectedStatus||order.courier_id!==data.expectedCourierId)throw new AppError(409,'Заказ уже изменился. Обновите сведения и проверьте действие.');
    if(['DELIVERED','CANCELLED'].includes(order.status))throw new AppError(409,'Завершённый заказ изменить нельзя.');
    if(['PICKED_UP','IN_TRANSIT'].includes(order.status)&&!data.custodyConfirmed)throw new AppError(409,'Сначала подтвердите согласованную передачу или возврат посылки.');
    if(data.action==='CANCEL'){
      await db.query("UPDATE qadam.orders SET status='CANCELLED',updated_at=clock_timestamp(),assignment_version=assignment_version+1 WHERE id=$1",[id]);
      await db.query("UPDATE qadam.order_photos SET state='RETIRED' WHERE order_id=$1 AND state IN ('READY','UPLOADING')",[id]);
      await trustEvent(db,{...order,status:'CANCELLED'},actor,'CANCEL',data.reason,order.courier_id,order.courier_id);await closeAvailableOrders(db,id,null,true);await queueCustomerOrderStatus(db,id,'CANCELLED');
    }else{
      if(!data.courierId||data.courierId===order.courier_id)throw new AppError(400,'Выберите другого курьера.');
      if(data.courierId===order.customer_id)throw new AppError(409,'Отправитель не может быть курьером собственного заказа.');
      if(!order.courier_id&&order.deliver_before&&new Date(order.deliver_before).getTime()<=Date.now())throw new AppError(409,'Желаемый интервал уже закончился. Согласуйте новый заказ.');
      await requireCourierAccess(db,data.courierId);
      const occupied=await db.query("SELECT 1 FROM qadam.orders WHERE courier_id=$1 AND id<>$2 AND status IN ('ACCEPTED','PICKED_UP','IN_TRANSIT') AND ($3::boolean OR price_kzt IS NOT NULL)",[data.courierId,id,order.price_kzt!==null]);
      if(occupied.rowCount)throw new AppError(409,'У выбранного курьера есть несовместимая активная доставка.');
      const courier={id:data.courierId} as User;
      let phone=(await phoneProfile(courier,db)).phone;
      if(order.price_kzt!==null){
        const car=await db.query("SELECT 1 FROM qadam.courier_applications WHERE user_id=$1 AND status='APPROVED' AND transport='CAR'",[data.courierId]);
        if(!car.rowCount)throw new AppError(409,'Для этого заказа нужен одобренный автокурьер.');phone=await requirePhone(courier,db);
      }
      const status:Status=['PICKED_UP','IN_TRANSIT'].includes(order.status)?order.status:'ACCEPTED';
      await db.query("UPDATE qadam.orders SET courier_id=$2,courier_phone=$3,status=$4,assignment_version=assignment_version+1,custody_assignment_version=CASE WHEN $4 IN ('PICKED_UP','IN_TRANSIT') THEN assignment_version+1 ELSE NULL END,custody_at=CASE WHEN $4 IN ('PICKED_UP','IN_TRANSIT') THEN coalesce(custody_at,clock_timestamp()) ELSE NULL END,updated_at=clock_timestamp() WHERE id=$1",[id,data.courierId,phone,status]);
      await db.query('DELETE FROM qadam.courier_locations WHERE order_id=$1',[id]);
      await db.query("UPDATE qadam.order_photos SET state='RETIRED' WHERE order_id=$1 AND state IN ('READY','UPLOADING')",[id]);
      if(order.courier_id)await rotateCode(db,id);
      await trustEvent(db,{...order,status},actor,'ASSIGN',data.reason,order.courier_id,data.courierId);await closeAvailableOrders(db,id,data.courierId);await queueCustomerOrderStatus(db,id,'ACCEPTED');
    }
    for(const courierId of new Set([order.courier_id,data.action==='ASSIGN'?data.courierId:null].filter((v):v is string=>!!v))){
      const receiver=(await db.query('SELECT telegram_user_id::text AS chat FROM qadam.telegram_identities WHERE user_id=$1 AND allows_write AND bot_blocked_at IS NULL',[courierId])).rows[0];
      if(receiver)await enqueueBotMessage(db,`dispatch:${id}:${data.requestKey}:${courierId}`,receiver.chat,{chat_id:receiver.chat,text:`QD-${order.number.padStart(4,'0')}: администратор ${data.action==='CANCEL'?'отменил заказ':'изменил назначение курьера'}. Проверьте свои доставки. Если посылка у вас, свяжитесь с командой Qadam.`});
    }
    await saveAction(db,actor,id,data.requestKey,data.action,hash,{ok:true});
  });
  return getOrder(actor,id);
}
