import { handle, requireUser } from '../../../../../../lib/http';
import { AppError } from '../../../../../../lib/errors';
import { geoapifyKey, takeMapBudget } from '../../../../../../lib/map-services';

export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ z: string; x: string; y: string }> }) {
  return handle(async () => {
    const actor = await requireUser(request);
    const raw = await context.params;
    if (!Object.values(raw).every((value) => /^(0|[1-9]\d{0,6})$/.test(value))) throw new AppError(400, 'Некорректный фрагмент карты.');
    const z = Number(raw.z), x = Number(raw.x), y = Number(raw.y);
    if (z > 19 || x >= 2 ** z || y >= 2 ** z) throw new AppError(400, 'Некорректный фрагмент карты.');
    const key = geoapifyKey();
    await takeMapBudget(actor.id, 'tile');
    const url = new URL(`https://maps.geoapify.com/v1/tile/positron/${z}/${x}/${y}@2x.png`);
    url.searchParams.set('apiKey', key); url.searchParams.set('lang', 'ru');
    let response: Response;
    try { response = await fetch(url, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(10000), redirect: 'error' }); }
    catch { throw new AppError(503, 'Не удалось загрузить карту.'); }
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png')) throw new AppError(503, 'Карта временно недоступна.');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 2097152) throw new AppError(503, 'Не удалось загрузить фрагмент карты.');
    return new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400', Vary: 'Cookie, Authorization', 'X-Content-Type-Options': 'nosniff' } });
  });
}
