import { z } from 'zod';
import { AppError } from './errors';
import { geoapifyKey, takeMapBudget } from './map-services';
import type { MapPoint, User } from './types';

export type AddressResult = MapPoint & { id: string; address: string; fullAddress?: string; detail: string; precision: 'building' | 'street' | 'area' };
export const addressSearchSchema = z.object({ query: z.string().trim().min(5).max(200).refine((s) => !/[\u0000-\u001f]/.test(s)) }).strict();
const providerResult = z.object({ results: z.array(z.object({
  lat: z.number(), lon: z.number(), country_code: z.string(),
  formatted: z.string().max(500), address_line1: z.string().max(300).optional(), address_line2: z.string().max(300).optional(),
  city: z.string().max(150).optional(),
  place_id: z.string().max(1000).optional(), housenumber: z.string().optional(), street: z.string().optional(),
  result_type: z.string().optional(), rank: z.object({ confidence_building_level: z.number().optional() }).optional(),
}).passthrough()).max(10) });

export async function searchAddresses(actor: User, input: z.infer<typeof addressSearchSchema>): Promise<AddressResult[]> {
  if (actor.role !== 'CUSTOMER') throw new AppError(403, 'Поиск адресов доступен при создании заказа клиентом.');
  const { query } = addressSearchSchema.parse(input);
  const key = geoapifyKey();
  await takeMapBudget(actor.id, 'geocode');
  const url = new URL('https://api.geoapify.com/v1/geocode/search');
  url.search = new URLSearchParams({ text: query, lang: 'ru', limit: '5', format: 'json', filter: 'countrycode:kz|rect:76.4,42.9,77.4,43.6', bias: 'proximity:76.8897,43.2389', apiKey: key }).toString();
  let response: Response;
  try { response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(7000), redirect: 'error' }); }
  catch { throw new AppError(503, 'Сервис поиска не ответил. Повторите поиск или укажите точку вручную.'); }
  if (!response.ok) throw new AppError(response.status === 429 ? 429 : 503, response.status === 429 ? 'Достигнут лимит поиска адресов. Попробуйте позже или укажите точку вручную.' : 'Сервис поиска временно недоступен. Укажите точку вручную.');
  const data = providerResult.safeParse(await response.json().catch(() => null));
  if (!data.success) throw new AppError(503, 'Не удалось прочитать результаты поиска. Укажите точку вручную.');
  const unique = new Set<string>();
  return data.data.results.sort((a, b) => Number(b.result_type === 'building') - Number(a.result_type === 'building')).flatMap((item) => {
    if (item.country_code !== 'kz' || item.lat < 42.9 || item.lat > 43.6 || item.lon < 76.4 || item.lon > 77.4) return [];
    const id = item.street && item.housenumber ? `${item.street.toLocaleLowerCase('ru')}:${item.housenumber.toLocaleLowerCase('ru')}` : `${item.lat.toFixed(6)},${item.lon.toFixed(6)}`;
    if (unique.has(id)) return []; unique.add(id);
    const building = !!item.housenumber && !!item.street && ['building', 'amenity'].includes(item.result_type ?? '') && (item.rank?.confidence_building_level ?? 0) >= 0.6;
    const address = item.street ? `${item.street}${item.housenumber ? `, ${item.housenumber}` : ''}` : item.address_line1 || item.formatted;
    const detail = item.city ? /^(almaty|alma-ata)$/i.test(item.city) ? 'Алматы' : item.city : item.address_line2 || 'Алматы и окрестности';
    return [{ id, latitude: item.lat, longitude: item.lon, address, fullAddress: (item.street ? `${address}, ${detail}` : item.formatted).slice(0, 300),
      detail, precision: building ? 'building' as const : item.street ? 'street' as const : 'area' as const }];
  });
}
