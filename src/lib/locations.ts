import { z } from 'zod';
import type { PoolClient } from 'pg';
import { transaction } from './db';
import { AppError } from './errors';
import { pointSchema } from './orders';
import type { CourierLocation, User } from './types';
import {lockCouriers,requireCourierAccess} from './trust-core';

export const locationSchema = pointSchema.extend({
  accuracy: z.number().min(0).max(100000).nullable(),
  capturedAt: z.iso.datetime(),
}).strict();

export async function persistOrderLocation(client: Pick<PoolClient,'query'>, id: string, courierId: string, data: z.infer<typeof locationSchema>,source:'MINI_APP'|'TELEGRAM_LIVE'='MINI_APP') {
  return client.query(`INSERT INTO qadam.courier_locations(order_id,courier_id,latitude,longitude,accuracy,captured_at,location_source)
    SELECT $1,$2,$3,$4,$5,$6,$7 WHERE $7='TELEGRAM_LIVE' OR NOT EXISTS(SELECT 1 FROM qadam.order_location_streams WHERE order_id=$1 AND state IN ('WAITING','LIVE') AND expires_at>clock_timestamp() AND (state='LIVE' OR created_at>clock_timestamp()-interval '5 minutes'))
    ON CONFLICT(order_id) DO UPDATE SET courier_id=excluded.courier_id,
    latitude=excluded.latitude,longitude=excluded.longitude,accuracy=excluded.accuracy,captured_at=excluded.captured_at,location_source=excluded.location_source,received_at=clock_timestamp()
    WHERE qadam.courier_locations.captured_at<excluded.captured_at
    RETURNING latitude,longitude,accuracy,captured_at AS "capturedAt",received_at AS "receivedAt"`,
  [id,courierId,data.latitude,data.longitude,data.accuracy,data.capturedAt,source]);
}

export async function reportLocation(actor: User, id: string, input: z.infer<typeof locationSchema>): Promise<CourierLocation> {
  if (actor.role !== 'COURIER') throw new AppError(403, 'Передавать позицию может только назначенный курьер.');
  z.uuid().parse(id);
  const data = locationSchema.parse(input);
  const age = Date.now() - Date.parse(data.capturedAt);
  if (age > 120000 || age < -30000) throw new AppError(400, 'Координаты устарели. Получите новую позицию и проверьте время устройства.');
  return transaction(async (client) => {
    await lockCouriers(client,[actor.id]);await requireCourierAccess(client,actor.id);
    // Use the same lock as assignment/status changes: delivery completion wins atomically.
    const order = (await client.query('SELECT courier_id,status FROM qadam.orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!order) throw new AppError(404, 'Заказ не найден.');
    if (order.courier_id !== actor.id) throw new AppError(403, 'Этот заказ вам не назначен.');
    if (!['ACCEPTED', 'PICKED_UP', 'IN_TRANSIT'].includes(order.status)) throw new AppError(409, 'Передача позиции для этого заказа завершена.');
    const stream=await client.query("SELECT 1 FROM qadam.order_location_streams WHERE order_id=$1 AND state IN ('WAITING','LIVE') AND expires_at>clock_timestamp() AND (state='LIVE' OR created_at>clock_timestamp()-interval '5 minutes')",[id]);
    if(stream.rowCount)throw new AppError(409,'Для заказа выбрана трансляция Telegram. Сначала остановите её использование в Qadam.');
    const previous = (await client.query(`SELECT latitude,longitude,accuracy,captured_at AS "capturedAt",received_at AS "receivedAt",
      received_at>clock_timestamp()-interval '5 seconds' AS throttled
      FROM qadam.courier_locations WHERE order_id=$1`, [id])).rows[0];
    // Retries and delayed fixes must never move the marker back to an older measurement.
    if (previous && Date.parse(data.capturedAt) <= new Date(previous.capturedAt).getTime()) {
      const { throttled: _, ...location } = previous; return location;
    }
    if (previous?.throttled) throw new AppError(429, 'Позиция уже обновлена. Следующая отправка через несколько секунд.');
    const result=await persistOrderLocation(client,id,actor.id,data);
    return result.rows[0];
  });
}
