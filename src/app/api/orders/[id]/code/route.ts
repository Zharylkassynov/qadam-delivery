import {checkMutation,handle,json,readJson,requireUser} from '../../../../../lib/http';
import {resetCode,viewCode} from '../../../../../lib/order-codes';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>json(await viewCode(await requireUser(request),(await context.params).id)));}
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>{checkMutation(request);return json(await resetCode(await requireUser(request),(await context.params).id,await readJson(request)));});}
