import { transaction, database } from './db';
import { appOrigin } from './deployment-config';
import { enqueueBotMessage, type Db, type BotJob } from './telegram-outbox';
import type { Status } from './types';
import { deliveryWindow,parcelLabels,type ParcelType } from './order-details';

const courier = `(u.role='COURIER' OR EXISTS(SELECT 1 FROM qadam.courier_applications a WHERE a.user_id=u.id AND a.status='APPROVED'))`;
const label = (number: string) => `QD-${number.padStart(4,'0')}`;
const orderUrl = (id: string, admin = false) => {
  const url = new URL('/', appOrigin()); url.searchParams.set('order',id);
  if (admin) url.searchParams.set('screen','adminOrders');
  return url.href;
};
const keyboard = (id: string, admin = false) => ({ inline_keyboard: [[{ text: 'Открыть заказ', web_app: { url: orderUrl(id,admin) } }]] });

async function noticeOrder(db: Db, id: string) {
  return (await db.query(`SELECT o.id,o.number::text,o.customer_id,o.pickup_address,o.destination_address,
    o.pickup_latitude,o.pickup_longitude,o.destination_latitude,o.destination_longitude,r.name AS courier_name,
    o.price_kzt,o.distance_m,o.duration_s,o.payer,o.payment_method,o.parcel_type,o.fragile,o.surprise,o.urgent,
    o.deliver_after AS "deliverAfter",o.deliver_before AS "deliverBefore"
    FROM qadam.orders o LEFT JOIN qadam.users r ON r.id=o.courier_id WHERE o.id=$1`, [id])).rows[0];
}
function distance(order: Record<string, unknown>) {
  if(typeof order.distance_m==='number')return `По дороге А → Б: ${(order.distance_m/1000).toLocaleString('ru-RU',{maximumFractionDigits:1})} км.`;
  const coordinates = ['pickup_latitude','pickup_longitude','destination_latitude','destination_longitude'].map(key=>order[key]);
  if (!coordinates.every(value=>typeof value==='number')) return 'Расстояние уточняется в приложении.';
  const [a,b,c,d]=coordinates as number[],rad=Math.PI/180;
  const h=Math.sin((c-a)*rad/2)**2+Math.cos(a*rad)*Math.cos(c*rad)*Math.sin((d-b)*rad/2)**2;
  const km=6371*2*Math.asin(Math.min(1,Math.sqrt(h)));
  return `Около ${km.toLocaleString('ru-RU',{maximumFractionDigits:1})} км по прямой.`;
}
export async function queueAvailableOrder(db: Db, id: string) {
  const order = await noticeOrder(db,id);
  const recipients = (await db.query(`SELECT u.id,t.telegram_user_id::text AS chat FROM qadam.courier_status s
    JOIN qadam.users u ON u.id=s.user_id JOIN qadam.telegram_identities t ON t.user_id=u.id
    WHERE s.online AND s.updated_at>now()-interval '8 hours' AND u.active AND ${courier}
      AND t.allows_write AND t.bot_blocked_at IS NULL AND u.id<>$1
      AND ($2::integer IS NULL OR EXISTS(SELECT 1 FROM qadam.courier_applications ca WHERE ca.user_id=u.id AND ca.status='APPROVED' AND ca.transport='CAR'))`, [order.customer_id,order.price_kzt])).rows;
  for (const recipient of recipients) {
    const saved = await db.query(`INSERT INTO qadam.order_notifications(order_id,user_id,chat_id)
      VALUES($1,$2,$3) ON CONFLICT(order_id,user_id,kind) DO NOTHING RETURNING id::text`, [id,recipient.id,recipient.chat]);
    if (!saved.rowCount) continue;
    await enqueueBotMessage(db,`order:${id}:available:${recipient.id}`,recipient.chat,{
      chat_id:recipient.chat,text:`Новый заказ ${label(order.number)}\nЗабрать: ${order.pickup_address}\nДоставить: ${order.destination_address}\n${distance(order)}${deliveryWindow(order)?`\nКо времени: ${deliveryWindow(order)} (Алматы).`:''}${order.parcel_type?`\n${parcelLabels[order.parcel_type as ParcelType]}.`:''}${order.fragile?' Хрупкое.':''}${order.surprise?' Сюрприз: сначала свяжитесь с отправителем.':''}${order.urgent?' Важно без задержки.':''}${order.price_kzt===null?'':`\nВыплата: ${order.price_kzt} ₸. Комиссия: 0 ₸.\n${order.payer==='RECIPIENT'?'Платит получатель':'Платит отправитель'} · ${order.payment_method==='CASH'?'наличные':'перевод Kaspi'}.`}`,
      reply_markup:keyboard(id),
    },'sendMessage',{orderId:id,notificationId:saved.rows[0].id});
  }
}

type Notification = { id: string; order_id: string; chat_id: string; message_id: string | null; closed_at: unknown; closed_text: string | null };
async function queueClosedEdit(db: Db, notice: Notification) {
  if (!notice.closed_at || !notice.closed_text || !notice.message_id) return;
  await enqueueBotMessage(db,`notification:${notice.id}:closed:${notice.message_id}`,String(notice.chat_id),{
    chat_id:notice.chat_id,message_id:Number(notice.message_id),text:notice.closed_text,reply_markup:{inline_keyboard:[]},
  },'editMessageText',{orderId:notice.order_id,notificationId:String(notice.id)});
}
export async function closeAvailableOrders(db: Db, id: string, winner: string | null, cancelled = false) {
  const order = await noticeOrder(db,id);
  const closed = await db.query(`UPDATE qadam.order_notifications SET closed_at=now(),
    closed_text=CASE WHEN user_id=$2::uuid THEN NULL ELSE $3 END WHERE order_id=$1 AND closed_at IS NULL
    RETURNING id::text,order_id,chat_id::text,message_id::text,closed_at,closed_text`,
  [id,winner,`${label(order.number)} — ${cancelled ? 'заказ отменён.' : 'заказ уже принят.'}`]);
  for (const notice of closed.rows) await queueClosedEdit(db,notice);
}
export async function queueCustomerOrderStatus(db: Db, id: string, status: Status) {
  const order = await noticeOrder(db,id);
  const identity = (await db.query(`SELECT t.telegram_user_id::text AS chat FROM qadam.telegram_identities t
    JOIN qadam.users u ON u.id=t.user_id WHERE t.user_id=$1 AND u.active AND t.allows_write AND t.bot_blocked_at IS NULL`, [order.customer_id])).rows[0];
  if (!identity) return;
  const texts: Partial<Record<Status,string>> = {
    ACCEPTED:`Курьер назначен: ${String(order.courier_name ?? '').replace(/[\r\n]/g,' ')}.`,
    PICKED_UP:'Посылка у курьера.', IN_TRANSIT:'Посылка в пути.', DELIVERED:'Посылка доставлена.', CANCELLED:'Заказ отменён.',
  };
  if (!texts[status]) return;
  await enqueueBotMessage(db,`order:${id}:status:${status}`,identity.chat,{chat_id:identity.chat,
    text:`${label(order.number)}\n${texts[status]}`,reply_markup:keyboard(id)},'sendMessage',{orderId:id});
}

export async function alertWaitingOrders() {
  return transaction(async db => {
    const admins = (await db.query(`SELECT u.id,t.telegram_user_id::text AS chat FROM qadam.administrators a
      JOIN qadam.users u ON u.id=a.user_id JOIN qadam.telegram_identities t ON t.user_id=u.id
      WHERE u.active AND t.allows_write AND t.bot_blocked_at IS NULL`)).rows;
    if (!admins.length) return 0;
    const waiting = await db.query(`SELECT id,number::text FROM qadam.orders WHERE status='SEARCHING_FOR_COURIER'
      AND courier_id IS NULL AND alerted_at IS NULL AND (greatest(created_at,coalesce(deliver_after,created_at))<now()-interval '10 minutes' OR deliver_before<=now())
      ORDER BY created_at,id LIMIT 20 FOR UPDATE SKIP LOCKED`);
    for (const order of waiting.rows) {
      for (const admin of admins) await enqueueBotMessage(db,`order:${order.id}:waiting:${admin.id}`,admin.chat,{
        chat_id:admin.chat,text:`${label(order.number)} ждёт курьера больше 10 минут. Проверьте заказ.`,reply_markup:keyboard(order.id,true),
      },'sendMessage',{orderId:order.id});
      await db.query('UPDATE qadam.orders SET alerted_at=now() WHERE id=$1',[order.id]);
    }
    return waiting.rowCount ?? 0;
  });
}

// Recheck eligibility immediately before sending a delayed availability notice.
export async function shouldSendOrderJob(job: BotJob) {
  if (!job.orderId || job.method==='editMessageText') return true;
  if (job.notificationId) {
    const row = await database().query(`SELECT 1 FROM qadam.order_notifications n JOIN qadam.orders o ON o.id=n.order_id
      JOIN qadam.users u ON u.id=n.user_id JOIN qadam.telegram_identities t ON t.user_id=u.id
      JOIN qadam.courier_status s ON s.user_id=u.id WHERE n.id=$1 AND n.closed_at IS NULL
      AND o.status='SEARCHING_FOR_COURIER' AND o.courier_id IS NULL AND u.active AND ${courier}
      AND (o.deliver_before IS NULL OR o.deliver_before>now())
      AND (o.price_kzt IS NULL OR EXISTS(SELECT 1 FROM qadam.courier_applications ca WHERE ca.user_id=u.id AND ca.status='APPROVED' AND ca.transport='CAR'))
      AND s.online AND s.updated_at>now()-interval '8 hours' AND t.telegram_user_id=$2
      AND t.allows_write AND t.bot_blocked_at IS NULL`,[job.notificationId,job.telegramId]);
    return Boolean(row.rowCount);
  }
  const row = await database().query(`SELECT 1 FROM qadam.telegram_identities t JOIN qadam.users u ON u.id=t.user_id
    JOIN qadam.orders o ON o.id=$1 WHERE t.telegram_user_id=$2 AND u.active AND t.allows_write AND t.bot_blocked_at IS NULL
    AND (o.customer_id=u.id OR (o.status='SEARCHING_FOR_COURIER' AND o.courier_id IS NULL
      AND EXISTS(SELECT 1 FROM qadam.administrators a WHERE a.user_id=u.id)))`,[job.orderId,job.telegramId]);
  return Boolean(row.rowCount);
}

export async function recordOrderDelivery(db: Db, job: BotJob, result: unknown) {
  if (!job.notificationId || job.method!=='sendMessage') return;
  const id = result && typeof result==='object' && 'message_id' in result ? result.message_id : undefined;
  if (typeof id!=='number' || !Number.isSafeInteger(id) || id<=0) throw new Error('Telegram message identifier missing');
  const saved = await db.query(`UPDATE qadam.order_notifications SET message_id=$2 WHERE id=$1
    RETURNING id::text,order_id,chat_id::text,message_id::text,closed_at,closed_text`,[job.notificationId,id]);
  if (saved.rowCount) await queueClosedEdit(db,saved.rows[0]);
}
