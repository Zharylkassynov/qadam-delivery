import { nearbyCouriers,nearbyBounds } from '../../../../lib/courier-presence';
import { handle,json,requireUser } from '../../../../lib/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request: Request) {
  return handle(async()=>{const actor=await requireUser(request),query=Object.fromEntries(new URL(request.url).searchParams);
    return json({couriers:await nearbyCouriers(actor,Object.keys(query).length?query:nearbyBounds)});});
}
