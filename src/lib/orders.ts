import { z } from 'zod';
import type { PoolClient } from 'pg';
import { database, transaction } from './db';
import { AppError } from './errors';
import { nextStatus, statuses, type Order, type Status, type User } from './types';

export const createOrderSchema = z.object({
  requestKey: z.uuid(),
  pickupAddress: z.string().trim().min(5).max(300),
  destinationAddress: z.string().trim().min(5).max(300),
  recipientName: z.string().trim().min(2).max(100),
  recipientPhone: z.string().trim().min(7).max(30).regex(/^[+\d\s()\-]+$/).refine((value) => value.replace(/\D/g, '').length >= 7),
  notes: z.string().trim().max(1000).default(''),
}).strict();
export const statusSchema = z.object({ status: z.enum(statuses) }).strict();
export type CreateOrder = z.infer<typeof createOrderSchema>;

const selectOrder = `SELECT o.id,o.number::text,o.customer_id AS "customerId",c.name AS "customerName",
  o.courier_id AS "courierId",r.name AS "courierName",o.pickup_address AS "pickupAddress",
  o.destination_address AS "destinationAddress",o.recipient_name AS "recipientName",
  o.recipient_phone AS "recipientPhone",o.notes,o.status,o.created_at AS "createdAt",o.updated_at AS "updatedAt",
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'status',e.status,'at',e.created_at,'actor',u.name) ORDER BY e.id)
    FROM qadam.order_events e JOIN qadam.users u ON u.id=e.actor_id WHERE e.order_id=o.id),'[]'::jsonb) AS events
  FROM qadam.orders o JOIN qadam.users c ON c.id=o.customer_id LEFT JOIN qadam.users r ON r.id=o.courier_id`;

async function readOrder(client: PoolClient, id: string): Promise<Order> {
  const result = await client.query(`${selectOrder} WHERE o.id=$1`, [id]);
  return result.rows[0];
}

async function event(client: PoolClient, id: string, actor: User, status: Status) {
  await client.query('INSERT INTO qadam.order_events(order_id,actor_id,status) VALUES($1,$2,$3)', [id, actor.id, status]);
}

export async function listOrders(actor: User): Promise<Order[]> {
  const where = actor.role === 'CUSTOMER'
    ? 'o.customer_id=$1'
    : "(o.courier_id=$1 OR (o.courier_id IS NULL AND o.status='SEARCHING_FOR_COURIER'))";
  const result = await database().query(`${selectOrder} WHERE ${where} ORDER BY o.created_at DESC LIMIT 100`, [actor.id]);
  return result.rows;
}

export async function createOrder(actor: User, input: CreateOrder): Promise<Order> {
  if (actor.role !== 'CUSTOMER') throw new AppError(403, 'Создавать заказы может только клиент.');
  // Validate here too, so scripts and tests cannot bypass the API validation.
  const data = createOrderSchema.parse(input);
  return transaction(async (client) => {
    const result = await client.query(`INSERT INTO qadam.orders(customer_id,request_key,pickup_address,destination_address,recipient_name,recipient_phone,notes,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,'CREATED') ON CONFLICT(customer_id,request_key) DO NOTHING RETURNING id`,
    [actor.id, data.requestKey, data.pickupAddress, data.destinationAddress, data.recipientName, data.recipientPhone, data.notes]);
    if (!result.rowCount) {
      const existing = await client.query('SELECT id FROM qadam.orders WHERE customer_id=$1 AND request_key=$2', [actor.id, data.requestKey]);
      const order = await readOrder(client, existing.rows[0].id);
      const fields = ['pickupAddress', 'destinationAddress', 'recipientName', 'recipientPhone', 'notes'] as const;
      if (fields.some((field) => order[field] !== data[field])) throw new AppError(409, 'Этот запрос уже использован для другого заказа. Обновите страницу.');
      return order;
    }
    const id = result.rows[0].id;
    await event(client, id, actor, 'CREATED');
    await client.query("UPDATE qadam.orders SET status='SEARCHING_FOR_COURIER',updated_at=now() WHERE id=$1", [id]);
    await event(client, id, actor, 'SEARCHING_FOR_COURIER');
    return readOrder(client, id);
  });
}

export async function acceptOrder(actor: User, id: string): Promise<Order> {
  if (actor.role !== 'COURIER') throw new AppError(403, 'Принимать заказы может только курьер.');
  z.uuid().parse(id);
  return transaction(async (client) => {
    // Lock this order until assignment and its audit event are committed together.
    const result = await client.query('SELECT status,courier_id FROM qadam.orders WHERE id=$1 FOR UPDATE', [id]);
    const order = result.rows[0];
    if (!order) throw new AppError(404, 'Заказ не найден.');
    if (order.courier_id === actor.id && order.status !== 'CANCELLED') return readOrder(client, id);
    if (order.status !== 'SEARCHING_FOR_COURIER' || order.courier_id) throw new AppError(409, 'Заказ уже принят другим курьером или больше недоступен.');
    await client.query("UPDATE qadam.orders SET courier_id=$1,status='ACCEPTED',updated_at=now() WHERE id=$2", [actor.id, id]);
    await event(client, id, actor, 'ACCEPTED');
    return readOrder(client, id);
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
      if (order.status === 'CANCELLED') return readOrder(client, id);
      if (!['CREATED', 'SEARCHING_FOR_COURIER'].includes(order.status)) throw new AppError(409, 'После назначения курьера отмена недоступна.');
    } else {
      if (order.courier_id !== actor.id) throw new AppError(403, 'Этот заказ вам не назначен.');
      if (order.status === target) return readOrder(client, id);
      if (nextStatus[order.status] !== target) throw new AppError(409, 'Недопустимый переход статуса. Обновите заказ и выполните следующий шаг.');
    }
    await client.query('UPDATE qadam.orders SET status=$1,updated_at=now() WHERE id=$2', [target, id]);
    await event(client, id, actor, target);
    return readOrder(client, id);
  });
}
