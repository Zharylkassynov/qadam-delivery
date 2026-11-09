import {handle} from '../../../../../../lib/http';
import {AppError} from '../../../../../../lib/errors';
import {geoapifyKey,takeMapBudget} from '../../../../../../lib/map-services';
import {publicRecipientDelivery,takeRecipientBudget} from '../../../../../../lib/recipient-tracking';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{z:string;x:string;y:string}>}){
  const response=await handle(async()=>{
    const token=request.headers.get('x-qadam-tracking')??'';
    await takeRecipientBudget(request,token,true);
    const delivery=await publicRecipientDelivery(token),point=delivery.location;
    if(!point||!delivery.mapAvailable)throw new AppError(404,'Карта сейчас недоступна. Статус доставки сохранён.');
    const raw=await context.params;
    if(!Object.values(raw).every(s=>/^\d{1,6}$/.test(s)))throw new AppError(400,'Некорректный фрагмент карты.');
    const z=Number(raw.z),x=Number(raw.x),y=Number(raw.y);
    const n=2**z,lat=point.latitude*Math.PI/180;
    const cx=Math.floor((point.longitude+180)/360*n),cy=Math.floor((1-Math.asinh(Math.tan(lat))/Math.PI)/2*n);
    if(z<12||z>17||x>=n||y>=n||Math.abs(cx-x)>1||Math.abs(cy-y)>1)throw new AppError(400,'Этот фрагмент карты недоступен.');
    await takeMapBudget(`recipient:${token}`,'tile');
    const url=new URL(`https://maps.geoapify.com/v1/tile/positron/${z}/${x}/${y}@2x.png`);
    url.searchParams.set('apiKey',geoapifyKey());url.searchParams.set('lang','ru');
    let upstream:Response;
    try{upstream=await fetch(url,{next:{revalidate:86400},signal:AbortSignal.timeout(10000),redirect:'error'});}catch{throw new AppError(503,'Карта временно недоступна.');}
    if(!upstream.ok||!upstream.headers.get('content-type')?.startsWith('image/png'))throw new AppError(503,'Карта временно недоступна.');
    const body=await upstream.arrayBuffer();
    if(body.byteLength>2097152)throw new AppError(503,'Фрагмент карты слишком большой.');
    return new Response(body,{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
  });
  if(response.status===429)response.headers.set('Retry-After','60');
  return response;
}
