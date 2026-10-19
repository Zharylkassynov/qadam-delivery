import { handle, json, requireUser } from '../../../lib/http';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  return handle(async () => {
    await requireUser(request);
    return json(process.env.GEOAPIFY_API_KEY ? {
      provider: 'geoapify', tileUrl: '/api/map-tiles/{z}/{x}/{y}', maxZoom: 19,
    } : { provider: 'osm', tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19 });
  });
}
