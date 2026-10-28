import { z } from 'zod';
import { database, transaction } from './db';
import { AppError } from './errors';
import { locationSchema, persistOrderLocation } from './locations';
import type { CourierLocation, User } from './types';
import {courierMapBounds} from './courier-map';

export const presenceSettingsSchema = z.union([
  z.object({ sharing: z.literal(true), consent: z.literal(true) }).strict(),
  z.object({ sharing: z.literal(false) }).strict(),
]);
export const presenceInputSchema = z.union([presenceSettingsSchema,locationSchema]);
const courierRole = `(u.role='COURIER' OR EXISTS(SELECT 1 FROM qadam.courier_applications a WHERE a.user_id=u.id AND a.status='APPROVED'))`;

export async function updateCourierPresence(actor: User, input: unknown): Promise<{ location: CourierLocation | null }> {
  const data = presenceInputSchema.parse(input);
  return transaction(async db => {
    // A shift-off request and a GPS write serialize on the same shift row.
    const shift = (await db.query(`SELECT s.online AND s.updated_at>clock_timestamp()-interval '8 hours' AS online
      FROM qadam.courier_status s JOIN qadam.users u ON u.id=s.user_id
      WHERE s.user_id=$1 AND u.active AND ${courierRole} FOR UPDATE OF s`,[actor.id])).rows[0];
    if (!shift) throw new AppError(403,'Геолокация доступна только одобренному курьеру со сменой.');
    if ('sharing' in data) {
      if (data.sharing && !shift.online) throw new AppError(409,'Сначала включите режим «Я на линии».');
      await db.query(`INSERT INTO qadam.courier_presence(user_id,sharing,consent_at) VALUES($1,$2,CASE WHEN $2 THEN now() END)
        ON CONFLICT(user_id) DO UPDATE SET sharing=excluded.sharing,
          consent_at=CASE WHEN excluded.sharing THEN now() ELSE qadam.courier_presence.consent_at END,
          latitude=NULL,longitude=NULL,accuracy=NULL,captured_at=NULL,received_at=NULL`,[actor.id,data.sharing]);
      return {location:null};
    }
    if (!shift.online) throw new AppError(409,'Смена завершена. Передача позиции остановлена.');
    const age=Date.now()-Date.parse(data.capturedAt);
    if (age>90000 || age < -30000) throw new AppError(400,'Координаты устарели. Проверьте время устройства и повторите.');
    const previous=(await db.query(`SELECT sharing,consent_at,latitude,longitude,accuracy,captured_at AS "capturedAt",received_at AS "receivedAt",
      received_at>clock_timestamp()-interval '5 seconds' AS throttled FROM qadam.courier_presence WHERE user_id=$1 FOR UPDATE`,[actor.id])).rows[0];
    if (!previous?.sharing || !previous.consent_at) throw new AppError(403,'Сначала разрешите передачу позиции во время смены.');
    if (previous.capturedAt && Date.parse(data.capturedAt)<=new Date(previous.capturedAt).getTime()) {
      return {location:{latitude:previous.latitude,longitude:previous.longitude,accuracy:previous.accuracy,capturedAt:previous.capturedAt,receivedAt:previous.receivedAt}};
    }
    if (previous.throttled) throw new AppError(429,'Позиция уже обновлена. Повторите через несколько секунд.');
    const saved=(await db.query(`UPDATE qadam.courier_presence SET latitude=$2,longitude=$3,accuracy=$4,captured_at=$5,received_at=clock_timestamp()
      WHERE user_id=$1 RETURNING latitude,longitude,accuracy,captured_at AS "capturedAt",received_at AS "receivedAt"`,
    [actor.id,data.latitude,data.longitude,data.accuracy,data.capturedAt])).rows[0];
    // Lock active orders in stable order. Completion cannot race a location write.
    const orders=await db.query(`SELECT id FROM qadam.orders WHERE courier_id=$1 AND status IN ('ACCEPTED','PICKED_UP','IN_TRANSIT') ORDER BY id FOR UPDATE`,[actor.id]);
    for(const order of orders.rows) await persistOrderLocation(db,order.id,actor.id,data);
    return {location:saved};
  });
}

export const nearbyBounds=courierMapBounds;
const boundsSchema=z.object({south:z.coerce.number().min(-90).max(90),north:z.coerce.number().min(-90).max(90),
  west:z.coerce.number().min(-180).max(180),east:z.coerce.number().min(-180).max(180)}).strict().refine(b=>b.north>b.south&&b.east>b.west&&b.north-b.south<=1&&b.east-b.west<=1.5);
export async function nearbyCouriers(actor: User, input: unknown = nearbyBounds) {
  if(actor.role!=='CUSTOMER') throw new AppError(403,'Карта доступна клиентам.');
  const parsed=boundsSchema.safeParse(input);
  if(!parsed.success) throw new AppError(400,'Проверьте область карты.');
  const b=parsed.data;
  const result=await database().query(`WITH rounded AS (
    SELECT round((p.latitude/0.0027)::numeric)::float8*0.0027 AS latitude,
      round((p.longitude/0.0037)::numeric)::float8*0.0037 AS longitude,p.captured_at
    FROM qadam.courier_presence p JOIN qadam.courier_status s ON s.user_id=p.user_id JOIN qadam.users u ON u.id=p.user_id
    WHERE p.sharing AND p.consent_at IS NOT NULL AND s.online AND s.updated_at>now()-interval '8 hours'
      AND p.received_at>=s.updated_at AND p.received_at>now()-interval '90 seconds' AND p.captured_at>now()-interval '90 seconds'
      AND p.captured_at<=now()+interval '30 seconds' AND u.active AND ${courierRole}
      AND EXISTS(SELECT 1 FROM qadam.users viewer WHERE viewer.id=$1 AND viewer.active)
      AND NOT EXISTS(SELECT 1 FROM qadam.orders o WHERE o.courier_id=u.id AND o.status IN ('ACCEPTED','PICKED_UP','IN_TRANSIT'))
  ) SELECT latitude,longitude,count(*)::int AS count,max(captured_at) AS "capturedAt" FROM rounded
    WHERE latitude BETWEEN $2 AND $3 AND longitude BETWEEN $4 AND $5
    GROUP BY latitude,longitude ORDER BY latitude,longitude LIMIT 200`,
  [actor.id,Math.max(b.south,nearbyBounds.south),Math.min(b.north,nearbyBounds.north),Math.max(b.west,nearbyBounds.west),Math.min(b.east,nearbyBounds.east)]);
  // Bounds are applied after rounding, so repeated viewport queries cannot recover raw coordinates.
  return result.rows as {latitude:number;longitude:number;count:number;capturedAt:string}[];
}
