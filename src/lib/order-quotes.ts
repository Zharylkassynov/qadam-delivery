import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { database } from './db';
import { AppError } from './errors';
import { calculatePrice,tariffSchema,type Tariff } from './pricing';
import { quoteRoute,type QuoteRoute } from './quote-routing';
import { takeMapBudget } from './map-services';
import type { MapPoint,OrderQuote,User } from './types';
import { deliveryPilot,insideDeliveryPilot } from './delivery-pilot';

export const paymentSchema=z.object({payer:z.enum(['SENDER','RECIPIENT']),paymentMethod:z.enum(['KASPI_TRANSFER','CASH'])});
const point=z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180)}).strict();
export const quoteInputSchema=z.object({
  pickupAddress:z.string().trim().min(5).max(300),destinationAddress:z.string().trim().min(5).max(300),
  recipientName:z.string().trim().min(2).max(100),recipientPhone:z.string().trim().min(7).max(30).regex(/^[+\d\s()\-]+$/),
  notes:z.string().trim().max(1000).default(''),pickupPoint:point,destinationPoint:point,
  transport:z.literal('CAR'),shareContact:z.literal(true),pilotTermsVersion:z.literal(deliveryPilot.termsVersion),...paymentSchema.shape,
}).strict();
export type QuoteInput=z.infer<typeof quoteInputSchema>;
type Db=Pick<PoolClient,'query'>;
export async function currentTariff(db:Db=database()):Promise<Tariff|null>{
  const row=(await db.query('SELECT active,config FROM qadam.pricing_settings WHERE singleton=true')).rows[0];
  if(!row?.active)return null;
  const parsed=tariffSchema.safeParse(row.config);
  if(!parsed.success || parsed.data.ttlSeconds>deliveryPilot.maxQuoteSeconds
    || !insideDeliveryPilot({latitude:parsed.data.zone.south,longitude:parsed.data.zone.west})
    || !insideDeliveryPilot({latitude:parsed.data.zone.north,longitude:parsed.data.zone.east}))throw new AppError(503,'Расчёт стоимости временно недоступен.');
  return parsed.data;
}
export function quoteFingerprint(data:QuoteInput){
  const x=quoteInputSchema.parse(data);
  return createHash('sha256').update(JSON.stringify([x.pickupAddress,x.destinationAddress,x.recipientName,x.recipientPhone,x.notes,
    x.pickupPoint.latitude,x.pickupPoint.longitude,x.destinationPoint.latitude,x.destinationPoint.longitude,x.transport,x.payer,x.paymentMethod,x.shareContact,x.pilotTermsVersion])).digest('hex');
}
function inside(point:MapPoint,tariff:Tariff){const z=tariff.zone;return point.latitude>=z.south&&point.latitude<=z.north&&point.longitude>=z.west&&point.longitude<=z.east;}
export async function createQuote(actor:User,input:unknown,calculate:(a:MapPoint,b:MapPoint)=>Promise<QuoteRoute>=quoteRoute):Promise<OrderQuote>{
  if(actor.role!=='CUSTOMER')throw new AppError(403,'Рассчитать доставку может только клиент.');
  const parsed=quoteInputSchema.safeParse(input);if(!parsed.success)throw new AppError(400,'Проверьте адреса, точки, получателя и способ оплаты.');
  const data=parsed.data,tariff=await currentTariff();
  if(!tariff)throw new AppError(503,'Автоматическая цена пока не включена.');
  if(!inside(data.pickupPoint,tariff)||!inside(data.destinationPoint,tariff))throw new AppError(422,'Одна из точек находится за пределами зоны расчёта. Измените адрес.');
  await takeMapBudget(actor.id,'quote');
  const route=await calculate(data.pickupPoint,data.destinationPoint);
  if(route.provider!==tariff.provider||!Number.isFinite(route.measuredAt.getTime())||route.measuredAt.getTime()>Date.now()+5000||Date.now()-route.measuredAt.getTime()>tariff.ttlSeconds*1000-10000)throw new AppError(503,'Данные дороги устарели. Повторите расчёт.');
  if(route.distanceM>deliveryPilot.maxDistanceM||route.durationS>deliveryPilot.maxDurationS)throw new AppError(422,'Дорога превышает 15 км или 60 минут. Для такой доставки обратитесь к команде Qadam: @zharlkssnv.');
  const breakdown={...calculatePrice(tariff,route.distanceM,route.durationS),pilotTermsVersion:data.pilotTermsVersion};
  // Provider geometry and raw response are not persisted or returned by quotes.
  const result=await database().query(`INSERT INTO qadam.order_quotes(owner_id,input_hash,tariff_version,price_kzt,breakdown,distance_m,duration_s,provider,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,expires_at AS "expiresAt"`,
  [actor.id,quoteFingerprint(data),tariff.version,breakdown.totalKzt,JSON.stringify(breakdown),route.distanceM,route.durationS,route.provider,new Date(route.measuredAt.getTime()+tariff.ttlSeconds*1000)]);
  // Bounded retention for abandoned quotes; never remove an order's used quote.
  await database().query("DELETE FROM qadam.order_quotes WHERE id IN (SELECT id FROM qadam.order_quotes WHERE used_at IS NULL AND expires_at<now()-interval '1 day' LIMIT 100)");
  return {id:result.rows[0].id,expiresAt:result.rows[0].expiresAt,priceKzt:breakdown.totalKzt,breakdown,distanceM:route.distanceM,durationS:route.durationS,tariffVersion:tariff.version};
}
export async function lockQuote(db:Db,actor:User,id:string,data:QuoteInput){
  const row=(await db.query(`SELECT *,expires_at>clock_timestamp() AS fresh FROM qadam.order_quotes WHERE id=$1 AND owner_id=$2 FOR UPDATE`,[id,actor.id])).rows[0];
  if(!row)throw new AppError(409,'Предложение цены недоступно. Рассчитайте стоимость заново.');
  if(row.used_at||!row.fresh)throw new AppError(409,'Цена больше не действует. Рассчитайте стоимость заново.');
  if(row.input_hash!==quoteFingerprint(data))throw new AppError(409,'Параметры доставки изменились. Рассчитайте стоимость заново.');
  return row;
}
