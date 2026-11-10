import {checkMutation,handle,json,readJson,requireUser} from '../../../../../lib/http';
import {correctHandoffPoint} from '../../../../../lib/order-handoffs';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>{
  checkMutation(request);return json({order:await correctHandoffPoint(await requireUser(request),(await context.params).id,await readJson(request))});
});}
