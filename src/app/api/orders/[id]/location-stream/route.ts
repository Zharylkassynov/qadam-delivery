import {checkMutation,handle,json,readJson,requireUser} from '../../../../../lib/http';
import {streamStatus,changeLocationStream} from '../../../../../lib/order-location-streams';
export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){return handle(async()=>json(await streamStatus(await requireUser(request),(await context.params).id)));}
export async function POST(request:Request,context:Context){return handle(async()=>{checkMutation(request);return json(await changeLocationStream(await requireUser(request),(await context.params).id,await readJson(request)));});}
