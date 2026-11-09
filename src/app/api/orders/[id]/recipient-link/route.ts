import {checkMutation,handle,json,readJson,requireUser} from '../../../../../lib/http';
import {recipientLink} from '../../../../../lib/recipient-tracking';
import {z} from 'zod';
export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){return handle(async()=>json({link:await recipientLink(await requireUser(request),(await context.params).id)}));}
export async function POST(request:Request,context:Context){return handle(async()=>{
  checkMutation(request);const actor=await requireUser(request);
  const {action}=z.object({action:z.enum(['create','revoke'])}).strict().parse(await readJson(request));
  return json({link:await recipientLink(actor,(await context.params).id,action)});
});}
