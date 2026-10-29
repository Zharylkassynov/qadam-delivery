import { z } from 'zod';
import { database } from './db';
import { AppError } from './errors';
import { geoapifyKey, takeMapBudget } from './map-services';
import type { DeliveryRoute, MapPoint, User } from './types';
import { quoteRoute } from './quote-routing';
import { currentTariff } from './order-quotes';

const coordinate = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const resultSchema = z.object({ features: z.array(z.object({
  properties: z.object({ distance: z.number().min(0).max(500000), distance_units: z.literal('meters') }),
  geometry: z.object({ type: z.literal('MultiLineString'), coordinates: z.array(z.array(coordinate).min(2).max(10000)).min(1).max(10) }),
})).min(1).max(1) });
const available = 'Не удалось построить маршрут. Повторите расчёт или откройте навигацию.';
const inArea = (point: MapPoint) => point.latitude >= 42.9 && point.latitude <= 43.6 && point.longitude >= 76.4 && point.longitude <= 77.4;

async function providerJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new AppError(503, available);
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 1048576) { await reader.cancel(); throw new AppError(503, available); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function orderRoute(actor: User, orderId: string): Promise<DeliveryRoute | null> {
  if (!z.uuid().safeParse(orderId).success) throw new AppError(400, 'Некорректный номер заказа.');
  // Match order visibility on every request, including cache hits. Never accept
  // coordinates, courier IDs or provider URLs supplied by the caller.
  const result = await database().query(`SELECT pickup_latitude AS "aLat",pickup_longitude AS "aLon",
    destination_latitude AS "bLat",destination_longitude AS "bLon",price_kzt AS "priceKzt" FROM qadam.orders
    WHERE id=$1 AND (($3='CUSTOMER' AND customer_id=$2) OR
      ($3='COURIER' AND (courier_id=$2 OR (courier_id IS NULL AND status='SEARCHING_FOR_COURIER'
        AND (price_kzt IS NULL OR EXISTS(SELECT 1 FROM qadam.courier_applications ca WHERE ca.user_id=$2 AND ca.status='APPROVED' AND ca.transport='CAR'))))) OR
      EXISTS(SELECT 1 FROM qadam.administrators a JOIN qadam.users u ON u.id=a.user_id
        WHERE a.user_id=$2 AND u.active=true))`, [orderId, actor.id, actor.role]);
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'Заказ недоступен.');
  if (row.aLat === null || row.aLon === null || row.bLat === null || row.bLon === null) return null;
  const a = { latitude: row.aLat, longitude: row.aLon }, b = { latitude: row.bLat, longitude: row.bLon };
  if(row.priceKzt!==null){
    if(!await currentTariff())throw new AppError(503,'Маршрут сейчас недоступен. Цена заказа сохранена; можно открыть внешнюю навигацию.');
    await takeMapBudget(actor.id,'quote');
    const route=await quoteRoute(a,b);
    return {mode:'drive',distanceMeters:route.distanceM,paths:route.paths};
  }
  if (!inArea(a) || !inArea(b)) throw new AppError(422, 'Маршрут доступен для Алматы и окрестностей. Для других точек откройте навигацию.');
  if (!process.env.GEOAPIFY_API_KEY?.trim()) throw new AppError(503, 'Сервис маршрутов временно недоступен. Откройте навигацию.');
  const key = geoapifyKey();
  await takeMapBudget(actor.id, 'route');
  const url = new URL('https://api.geoapify.com/v1/routing');
  url.search = new URLSearchParams({ waypoints: `${a.latitude},${a.longitude}|${b.latitude},${b.longitude}`, mode: 'drive', traffic: 'free_flow', units: 'metric', format: 'geojson', apiKey: key }).toString();
  try {
    // Only provider data is cached; session authorization and our JSON response
    // are never shared. GPS polling does not affect this fixed A-to-B route.
    const response = await fetch(url, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (response.status === 429) throw new AppError(429, 'Сервис маршрутов перегружен. Попробуйте позже или откройте навигацию.');
    if (!response.ok) throw new AppError(503, available);
    const parsed = resultSchema.safeParse(await providerJson(response));
    if (!parsed.success) throw new AppError(503, available);
    const route = parsed.data.features[0];
    const paths = route.geometry.coordinates.map(line => line.map(([lon, lat]): [number, number] => [lat, lon]));
    if (paths.reduce((sum, line) => sum + line.length, 0) > 10000) throw new AppError(503, available);
    // Reject unrelated or implausibly distant geometry instead of drawing a fake
    // straight line or a route from an unexpected provider response.
    const close = (point: number[], target: MapPoint) => Math.hypot((point[0] - target.latitude) * 111000, (point[1] - target.longitude) * 81000) <= 2000;
    if (!close(paths[0][0], a) || !close(paths.at(-1)!.at(-1)!, b)) throw new AppError(503, available);
    return { mode: 'drive', distanceMeters: route.properties.distance, paths };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, available);
  }
}
