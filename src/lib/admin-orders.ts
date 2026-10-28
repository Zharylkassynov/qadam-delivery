import { z } from 'zod';
import { database } from './db';
import { AppError } from './errors';
import { requireAdministrator } from './administrators';
import { selectOrder } from './orders';
import { adminOrderFilters, type AdminOrder, type AdminOrdersPage, type User } from './types';
import { alertWaitingOrders } from './order-notifications';

const querySchema = z.object({
  search: z.string().trim().max(100).default(''),
  filter: z.enum(adminOrderFilters).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
}).strict();
const filters = {
  all: 'true',
  unassigned: "o.status='SEARCHING_FOR_COURIER' AND o.courier_id IS NULL",
  active: "o.status NOT IN ('DELIVERED','CANCELLED')",
  history: "o.status IN ('DELIVERED','CANCELLED')",
};
// Literal substring matching: '%' and '_' in the input are not SQL wildcards.
const search = `($1='' OR strpos(lower(o.pickup_address),lower($1))>0
  OR strpos(lower(o.destination_address),lower($1))>0
  OR strpos(lower('QD-' || lpad(o.number::text,greatest(4,length(o.number::text)),'0')),lower($1))>0)`;

export async function listAdminOrders(actor: User, input: unknown = {}): Promise<AdminOrdersPage> {
  const db = database(); await requireAdministrator(db, actor);
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) throw new AppError(400, 'Проверьте поиск, фильтр и страницу заказов.');
  await alertWaitingOrders();
  const q = parsed.data;
  // Rows and counters share one statement snapshot. Parameters contain all user input.
  const result = await db.query(`WITH counts AS (
    SELECT count(*)::int AS "all",
      (count(*) FILTER (WHERE ${filters.unassigned}))::int AS unassigned,
      (count(*) FILTER (WHERE ${filters.active}))::int AS active,
      (count(*) FILTER (WHERE ${filters.history}))::int AS history
    FROM qadam.orders o WHERE ${search}
  ), page AS (
    ${selectOrder} WHERE ${search} AND (${filters[q.filter]})
    ORDER BY o.created_at DESC,o.id DESC LIMIT $2 OFFSET $3
  ) SELECT (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p."createdAt" DESC,p.id DESC),'[]'::jsonb) FROM page p) AS orders,
    to_jsonb(counts) AS counts FROM counts`, [q.search, q.limit, q.offset]);
  const row = result.rows[0];
  return { orders: row.orders, counts: row.counts, total: row.counts[q.filter] };
}

export async function getAdminOrder(actor: User, id: string): Promise<AdminOrder> {
  const db = database(); await requireAdministrator(db, actor);
  if (!z.uuid().safeParse(id).success) throw new AppError(400, 'Некорректный номер заказа.');
  const result = await db.query(`SELECT detail.*,a.transport AS "courierTransport"
    FROM (${selectOrder} WHERE o.id=$1) detail
    LEFT JOIN qadam.courier_applications a ON a.user_id=detail."courierId" AND a.status='APPROVED'`, [id]);
  if (!result.rows[0]) throw new AppError(404, 'Заказ не найден.');
  return result.rows[0];
}
