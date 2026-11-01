import {checkMutation,handle,json,readJson,requireUser} from '../../../../../../lib/http';
import {manageOrder,managementInfo} from '../../../../../../lib/order-management';
import {scheduleTelegramJobs} from '../../../../../../lib/telegram-jobs';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>json(await managementInfo(await requireUser(request),(await context.params).id)));}
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>{checkMutation(request);const order=await manageOrder(await requireUser(request),(await context.params).id,await readJson(request));scheduleTelegramJobs();return json({order});});}
