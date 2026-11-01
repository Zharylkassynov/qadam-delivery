import {checkMutation,handle,json,readJson,requireUser} from '../../../../../../lib/http';
import {changeCourierBlock,courierBlockState} from '../../../../../../lib/courier-blocks';
import {requireAdministrator} from '../../../../../../lib/administrators';
import {database} from '../../../../../../lib/db';
import {scheduleTelegramJobs} from '../../../../../../lib/telegram-jobs';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>{const actor=await requireUser(request);await requireAdministrator(database(),actor);return json(await courierBlockState(actor,(await context.params).id));});}
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>{checkMutation(request);const result=await changeCourierBlock(await requireUser(request),(await context.params).id,await readJson(request));scheduleTelegramJobs();return json(result);});}
