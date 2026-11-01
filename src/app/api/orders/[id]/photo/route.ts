import {checkMutation,handle,json,readJson,requireUser} from '../../../../../lib/http';
import {readOrderPhoto,uploadOrderPhoto} from '../../../../../lib/order-proof';
import {AppError} from '../../../../../lib/errors';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>{
  const bytes=await readOrderPhoto(await requireUser(request),(await context.params).id);
  return new Response(Uint8Array.from(bytes),{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','Vary':'Cookie, Authorization','X-Content-Type-Options':'nosniff','Content-Disposition':'inline; filename="delivery.jpg"'}});
});}
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>{
  checkMutation(request);const actor=await requireUser(request);if(actor.role!=='COURIER')throw new AppError(403,'Фото прикладывает назначенный курьер.');
  return json(await uploadOrderPhoto(actor,(await context.params).id,await readJson(request,1403000)));
});}
