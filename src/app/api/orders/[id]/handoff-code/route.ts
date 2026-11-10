import {z} from 'zod';
import {checkMutation,handle,json,readJson,requireUser} from '../../../../../lib/http';
import {issueHandoffCode,viewHandoffCode} from '../../../../../lib/order-handoffs';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>{
  const stage=z.enum(['PICKUP','DROPOFF']).parse(new URL(request.url).searchParams.get('stage'));
  return json(await viewHandoffCode(await requireUser(request),(await context.params).id,stage));
});}
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>{
  checkMutation(request);return json(await issueHandoffCode(await requireUser(request),(await context.params).id,await readJson(request)));
});}
