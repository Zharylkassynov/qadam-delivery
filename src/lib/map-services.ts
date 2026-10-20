import { createHash } from 'node:crypto';
import { transaction } from './db';
import { AppError } from './errors';

export async function takeMapBudget(userId: string, service: 'geocode' | 'tile' | 'route') {
  const actor = createHash('sha256').update(userId).digest('hex').slice(0, 32);
  await transaction(async (client) => {
    // Short transaction only: never hold a pool connection during a provider call.
    await client.query('SELECT pg_advisory_xact_lock(621202610191408)');
    const now = Number((await client.query('SELECT extract(epoch FROM clock_timestamp())::bigint AS seconds')).rows[0].seconds);
    const minute = Math.floor(now / 60), day = Math.floor(now / 86400);
    const limits: [string, number, number][] = service === 'geocode'
      ? [[`geo:user:${actor}:${minute}`, 12, now + 120], [`geo:global:${minute}`, 120, now + 120], [`geo:day:${day}`, 1000, now + 86400], [`geo:second:${now}`, 4, now + 5]]
      : service === 'route'
        ? [[`route:user:${actor}:${minute}`, 12, now + 120], [`route:global:${minute}`, 40, now + 120], [`route:day:${day}`, 300, now + 86400], [`route:second:${now}`, 2, now + 5]]
        : [[`tile:user:${actor}:${minute}`, 240, now + 120], [`tile:global:${minute}`, 600, now + 120], [`tile:day:${day}`, 6000, now + 86400]];
    await client.query('DELETE FROM qadam.service_limits WHERE expires_at<clock_timestamp()');
    for (const [bucket, max, expiry] of limits) {
      const result = await client.query(`INSERT INTO qadam.service_limits(bucket,hits,expires_at) VALUES($1,1,to_timestamp($2))
        ON CONFLICT(bucket) DO UPDATE SET hits=qadam.service_limits.hits+1 RETURNING hits`, [bucket, expiry]);
      if (result.rows[0].hits > max) throw new AppError(429, service === 'geocode' ? 'Слишком много поисков. Подождите немного или укажите точку вручную.' : service === 'route' ? 'Достигнут лимит расчёта маршрута. Попробуйте позже или откройте навигацию.' : 'Карта временно недоступна: достигнут лимит запросов. Адреса и статусы сохранены.');
    }
  });
}

export function geoapifyKey() {
  const key = process.env.GEOAPIFY_API_KEY?.trim();
  if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new AppError(503, 'Поиск адресов временно недоступен. Укажите точку на карте вручную.');
  return key;
}
