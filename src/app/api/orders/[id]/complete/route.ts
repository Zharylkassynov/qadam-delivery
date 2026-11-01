import {checkMutation,handle,json,readJson,requireUser} from '../../../../../lib/http';
import {completeOrder} from '../../../../../lib/order-proof';
import {scheduleTelegramJobs} from '../../../../../lib/telegram-jobs';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>{
  checkMutation(request);const order=await completeOrder(await requireUser(request),(await context.params).id,await readJson(request));scheduleTelegramJobs();return json({order});
});}
