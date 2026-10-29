import { z } from 'zod';
import type { PoolClient } from 'pg';
import { database, transaction } from './db';
import { AppError } from './errors';
import { nextStatus, statuses, type Order, type Status, type User } from './types';
import { alertWaitingOrders, closeAvailableOrders, queueAvailableOrder, queueCustomerOrderStatus } from './order-notifications';
import { orderReference } from './order-links';
import { currentTariff,lockQuote,paymentSchema,quoteInputSchema } from './order-quotes';
import { requirePhone,phoneProfile } from './user-profiles';

export const pointSchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).strict();
export const createOrderSchema = z.object({
  requestKey: z.uuid(),
  pickupAddress: z.string().trim().min(5).max(300),
  destinationAddress: z.string().trim().min(5).max(300),
  recipientName: z.string().trim().min(2).max(100),
  recipientPhone: z.string().trim().min(7).max(30).regex(/^[+\d\s()\-]+$/).refine((value) => value.replace(/\D/g, '').length >= 7),
  notes: z.string().trim().max(1000).default(''),
  pickupPoint: pointSchema.nullable().optional(),
  destinationPoint: pointSchema.nullable().optional(),
  quoteId: z.uuid().optional(),
  payer: paymentSchema.shape.payer.optional(),
  paymentMethod: paymentSchema.shape.paymentMethod.optional(),
  transport: z.literal('CAR').optional(),
  shareContact: z.boolean().optional(),
}).strict();
export const statusSchema = z.object({ status: z.enum(statuses) }).strict();
export type CreateOrder = z.infer<typeof createOrderSchema>;

export const selectOrder = `SELECT o.id,o.number::text,o.customer_id AS "customerId",c.name AS "customerName",
  o.courier_id AS "courierId",r.name AS "courierName",o.pickup_address AS "pickupAddress",
  o.destination_address AS "destinationAddress",o.recipient_name AS "recipientName",
  o.recipient_phone AS "recipientPhone",o.notes,o.status,o.created_at AS "createdAt",o.updated_at AS "updatedAt",
  o.quote_id AS "quoteId",o.payer,o.payment_method AS "paymentMethod",
  o.sender_phone AS "senderPhone",o.courier_phone AS "courierPhone",
  CASE WHEN o.price_kzt IS NOT NULL THEN jsonb_build_object('priceKzt',o.price_kzt,'courierPayoutKzt',o.courier_payout_kzt,
    'platformFeeKzt',o.platform_fee_kzt,'distanceM',o.distance_m,'durationS',o.duration_s,
    'tariffVersion',o.tariff_version,'breakdown',o.pricing_details) END AS pricing,
  CASE WHEN o.pickup_latitude IS NOT NULL THEN jsonb_build_object('latitude',o.pickup_latitude,'longitude',o.pickup_longitude) END AS "pickupPoint",
  CASE WHEN o.destination_latitude IS NOT NULL THEN jsonb_build_object('latitude',o.destination_latitude,'longitude',o.destination_longitude) END AS "destinationPoint",
  (SELECT jsonb_build_object('latitude',l.latitude,'longitude',l.longitude,'accuracy',l.accuracy,'capturedAt',l.captured_at,'receivedAt',l.received_at)
    FROM qadam.courier_locations l WHERE l.order_id=o.id AND l.courier_id=o.courier_id) AS "courierLocation",
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'status',e.status,'at',e.created_at,'actor',u.name) ORDER BY e.id)
    FROM qadam.order_events e JOIN qadam.users u ON u.id=e.actor_id WHERE e.order_id=o.id),'[]'::jsonb) AS events
  FROM qadam.orders o JOIN qadam.users c ON c.id=o.customer_id LEFT JOIN qadam.users r ON r.id=o.courier_id`;

const eligibleCar=`EXISTS(SELECT 1 FROM qadam.courier_applications ca WHERE ca.user_id=$1 AND ca.status='APPROVED' AND ca.transport='CAR')`;

// Apply this to every ordinary order response, including mutation retries.
async function protectRecipientContacts(client: Pick<PoolClient, 'query'>, actor: User, orders: Order[]): Promise<Order[]> {
  if (actor.role !== 'COURIER' || orders.every(order => order.courierId === actor.id)) return orders;
  // Recheck private membership rather than trusting a supplied isAdmin flag.
  const admin = await client.query(`SELECT 1 FROM qadam.administrators a
    JOIN qadam.users u ON u.id=a.user_id WHERE a.user_id=$1 AND u.active=true`, [actor.id]);
  if (admin.rowCount) return orders;
  return orders.map(order => order.courierId === actor.id ? order : { ...order, recipientName: null, recipientPhone: null, senderPhone:null,courierPhone:null });
}

async function readOrder(client: PoolClient, id: string, actor: User): Promise<Order> {
  const result = await client.query(`${selectOrder} WHERE o.id=$1`, [id]);
  return (await protectRecipientContacts(client, actor, result.rows))[0];
}

async function event(client: PoolClient, id: string, actor: User, status: Status) {
  await client.query('INSERT INTO qadam.order_events(order_id,actor_id,status) VALUES($1,$2,$3)', [id, actor.id, status]);
}

export async function listOrders(actor: User): Promise<Order[]> {
  await alertWaitingOrders();
  const where = actor.role === 'CUSTOMER'
    ? 'o.customer_id=$1'
    : `(o.courier_id=$1 OR (o.courier_id IS NULL AND o.status='SEARCHING_FOR_COURIER' AND (o.price_kzt IS NULL OR ${eligibleCar})))`;
  const result = await database().query(`${selectOrder} WHERE ${where} ORDER BY o.created_at DESC LIMIT 100`, [actor.id]);
  return protectRecipientContacts(database(), actor, result.rows);
}

export async function getOrder(actor: User, reference: string): Promise<Order> {
  const ref = orderReference(reference);
  if (!ref) throw new AppError(404, 'Заказ не найден.');
  const result = await database().query(`${selectOrder} WHERE ${ref.includes('-') ? 'o.id=$2::uuid' : 'o.number=$2::bigint'}
    AND (o.customer_id=$1 OR ($3='COURIER' AND (o.courier_id=$1 OR (o.courier_id IS NULL AND o.status='SEARCHING_FOR_COURIER' AND (o.price_kzt IS NULL OR ${eligibleCar}))))
      OR EXISTS(SELECT 1 FROM qadam.administrators a JOIN qadam.users u ON u.id=a.user_id WHERE a.user_id=$1 AND u.active))`,
  [actor.id, ref, actor.role]);
  if (!result.rowCount) throw new AppError(404, 'Заказ не найден или больше недоступен.');
  return (await protectRecipientContacts(database(), actor, result.rows))[0];
}

export async function createOrder(actor: User, input: CreateOrder): Promise<Order> {
  if (actor.role !== 'CUSTOMER') throw new AppError(403, 'Создавать заказы может только клиент.');
  // Validate here too, so scripts and tests cannot bypass the API validation.
  const data = createOrderSchema.parse(input);
  return transaction(async (client) => {
    // Serialize retries before checking quote expiry or use. Same request_key
    // must return its committed order even when two copies arrive together.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${actor.id}:${data.requestKey}`]);
    const previous=await client.query('SELECT id FROM qadam.orders WHERE customer_id=$1 AND request_key=$2',[actor.id,data.requestKey]);
    if(previous.rowCount){
      const order=await readOrder(client,previous.rows[0].id,actor);
      for(const key of ['pickupAddress','destinationAddress','recipientName','recipientPhone','notes','quoteId','payer','paymentMethod'] as const){
        if((order[key]??null)!==(data[key]??null))throw new AppError(409,'Этот запрос уже использован для другого заказа. Обновите страницу.');
      }
      for(const key of ['pickupPoint','destinationPoint'] as const)if((order[key]?.latitude??null)!==(data[key]?.latitude??null)||(order[key]?.longitude??null)!==(data[key]?.longitude??null))throw new AppError(409,'Этот запрос уже использован для других точек доставки. Обновите страницу.');
      return order;
    }
    const tariff=await currentTariff(client);
    if(tariff&&!data.quoteId)throw new AppError(409,'Рассчитайте и подтвердите стоимость перед созданием заказа.');
    if(data.quoteId&&!tariff)throw new AppError(409,'Автоматическая цена отключена. Обновите условия доставки.');
    let quote=null,senderPhone=null;
    if(data.quoteId){
      // Build an explicit object: never forward server-only creation fields.
      const bound=quoteInputSchema.parse({pickupAddress:data.pickupAddress,destinationAddress:data.destinationAddress,
        recipientName:data.recipientName,recipientPhone:data.recipientPhone,notes:data.notes,pickupPoint:data.pickupPoint,
        destinationPoint:data.destinationPoint,transport:data.transport,payer:data.payer,paymentMethod:data.paymentMethod,shareContact:data.shareContact});
      senderPhone=await requirePhone(actor,client);quote=await lockQuote(client,actor,data.quoteId,bound);
    }else if(data.shareContact)senderPhone=(await phoneProfile(actor,client)).phone;
    const result = await client.query(`INSERT INTO qadam.orders(customer_id,request_key,pickup_address,destination_address,recipient_name,recipient_phone,notes,status,
      pickup_latitude,pickup_longitude,destination_latitude,destination_longitude,quote_id,price_kzt,courier_payout_kzt,platform_fee_kzt,
      distance_m,duration_s,tariff_version,pricing_details,price_source,traffic_source,payer,payment_method,sender_phone)
      VALUES($1,$2,$3,$4,$5,$6,$7,'CREATED',$8,$9,$10,$11,$12,$13,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      ON CONFLICT(customer_id,request_key) DO NOTHING RETURNING id`,
    [actor.id, data.requestKey, data.pickupAddress, data.destinationAddress, data.recipientName, data.recipientPhone, data.notes,
      data.pickupPoint?.latitude ?? null, data.pickupPoint?.longitude ?? null, data.destinationPoint?.latitude ?? null, data.destinationPoint?.longitude ?? null,
      quote?.id??null,quote?.price_kzt??null,quote?0:null,quote?.distance_m??null,quote?.duration_s??null,quote?.tariff_version??null,
      quote?JSON.stringify(quote.breakdown):null,quote?'route':null,quote?.provider??null,data.payer??null,data.paymentMethod??null,senderPhone]);
    if (!result.rowCount) {
      const existing = await client.query('SELECT id FROM qadam.orders WHERE customer_id=$1 AND request_key=$2', [actor.id, data.requestKey]);
      const order = await readOrder(client, existing.rows[0].id, actor);
      const fields = ['pickupAddress', 'destinationAddress', 'recipientName', 'recipientPhone', 'notes'] as const;
      if (fields.some((field) => order[field] !== data[field])) throw new AppError(409, 'Этот запрос уже использован для другого заказа. Обновите страницу.');
      for (const field of ['pickupPoint', 'destinationPoint'] as const) {
        if ((order[field]?.latitude ?? null) !== (data[field]?.latitude ?? null) || (order[field]?.longitude ?? null) !== (data[field]?.longitude ?? null))
          throw new AppError(409, 'Этот запрос уже использован для других точек доставки. Обновите страницу.');
      }
      return order;
    }
    const id = result.rows[0].id;
    if(quote)await client.query('UPDATE qadam.order_quotes SET used_at=clock_timestamp() WHERE id=$1',[quote.id]);
    await event(client, id, actor, 'CREATED');
    await client.query("UPDATE qadam.orders SET status='SEARCHING_FOR_COURIER',updated_at=now() WHERE id=$1", [id]);
    await event(client, id, actor, 'SEARCHING_FOR_COURIER');
    await queueAvailableOrder(client, id);
    return readOrder(client, id, actor);
  });
}

export async function acceptOrder(actor: User, id: string,shareContact=false): Promise<Order> {
  if (actor.role !== 'COURIER') throw new AppError(403, 'Принимать заказы может только курьер.');
  z.uuid().parse(id);
  return transaction(async (client) => {
    // Lock this order until assignment and its audit event are committed together.
    const result = await client.query('SELECT status,courier_id,price_kzt FROM qadam.orders WHERE id=$1 FOR UPDATE', [id]);
    const order = result.rows[0];
    if (!order) throw new AppError(404, 'Заказ не найден.');
    if (order.courier_id === actor.id && order.status !== 'CANCELLED') return readOrder(client, id, actor);
    if (order.status !== 'SEARCHING_FOR_COURIER' || order.courier_id) throw new AppError(409, 'Заказ уже принят другим курьером или больше недоступен.');
    let courierPhone=null;
    if(order.price_kzt!==null){
      if(!shareContact)throw new AppError(409,'Подтвердите передачу номера клиенту перед принятием заказа.');
      const car=await client.query("SELECT 1 FROM qadam.courier_applications WHERE user_id=$1 AND status='APPROVED' AND transport='CAR'",[actor.id]);
      if(!car.rowCount)throw new AppError(403,'Этот заказ доступен только одобренным автокурьерам.');
      courierPhone=await requirePhone(actor,client);
    }else if(shareContact)courierPhone=(await phoneProfile(actor,client)).phone;
    await client.query("UPDATE qadam.orders SET courier_id=$1,status='ACCEPTED',updated_at=now(),courier_phone=$3 WHERE id=$2", [actor.id, id,courierPhone]);
    await event(client, id, actor, 'ACCEPTED');
    await client.query(`INSERT INTO qadam.courier_locations(order_id,courier_id,latitude,longitude,accuracy,captured_at)
      SELECT $1,p.user_id,p.latitude,p.longitude,p.accuracy,p.captured_at FROM qadam.courier_presence p
      JOIN qadam.courier_status s ON s.user_id=p.user_id WHERE p.user_id=$2 AND p.sharing AND p.consent_at IS NOT NULL
        AND s.online AND s.updated_at>now()-interval '8 hours' AND p.received_at>=s.updated_at
        AND p.captured_at>now()-interval '90 seconds' AND p.received_at>now()-interval '90 seconds'
      ON CONFLICT(order_id) DO NOTHING`,[id,actor.id]);
    await closeAvailableOrders(client, id, actor.id);
    await queueCustomerOrderStatus(client, id, 'ACCEPTED');
    return readOrder(client, id, actor);
  });
}

export async function transitionOrder(actor: User, id: string, target: Status): Promise<Order> {
  z.uuid().parse(id);
  z.enum(statuses).parse(target);
  return transaction(async (client) => {
    const result = await client.query('SELECT status,customer_id,courier_id FROM qadam.orders WHERE id=$1 FOR UPDATE', [id]);
    const order = result.rows[0] as { status: Status; customer_id: string; courier_id: string | null } | undefined;
    if (!order) throw new AppError(404, 'Заказ не найден.');
    if (actor.role === 'CUSTOMER') {
      if (order.customer_id !== actor.id) throw new AppError(403, 'Нет доступа к этому заказу.');
      if (target !== 'CANCELLED') throw new AppError(403, 'Клиент может только отменить заказ до назначения курьера.');
      if (order.status === 'CANCELLED') return readOrder(client, id, actor);
      if (!['CREATED', 'SEARCHING_FOR_COURIER'].includes(order.status)) throw new AppError(409, 'После назначения курьера отмена недоступна.');
    } else {
      if (order.courier_id !== actor.id) throw new AppError(403, 'Этот заказ вам не назначен.');
      if (order.status === target) return readOrder(client, id, actor);
      if (nextStatus[order.status] !== target) throw new AppError(409, 'Недопустимый переход статуса. Обновите заказ и выполните следующий шаг.');
    }
    await client.query('UPDATE qadam.orders SET status=$1,updated_at=now() WHERE id=$2', [target, id]);
    await event(client, id, actor, target);
    if (target === 'CANCELLED') await closeAvailableOrders(client, id, null, true);
    await queueCustomerOrderStatus(client, id, target);
    return readOrder(client, id, actor);
  });
}
