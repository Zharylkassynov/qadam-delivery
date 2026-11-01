import {checkMutation,handle,json,readJson,requireUser} from '../../../../../lib/http';
import {rateOrder} from '../../../../../lib/order-ratings';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>{checkMutation(request);return json(await rateOrder(await requireUser(request),(await context.params).id,await readJson(request)));});}
