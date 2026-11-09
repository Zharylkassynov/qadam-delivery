import {handle,json} from '../../../lib/http';
import {publicRecipientDelivery,takeRecipientBudget} from '../../../lib/recipient-tracking';
export const runtime='nodejs';
export async function GET(request:Request){
  const response=await handle(async()=>{
    const token=request.headers.get('x-qadam-tracking')??'';
    await takeRecipientBudget(request,token);
    return json({delivery:await publicRecipientDelivery(token)});
  });
  response.headers.set('Referrer-Policy','no-referrer');
  response.headers.set('X-Robots-Tag','noindex, nofollow, noarchive');
  if(response.status===429)response.headers.set('Retry-After','60');
  return response;
}
