import { courierStatusSchema, getCourierStatus, setCourierStatus } from '../../../../lib/courier-status';
import { checkMutation, handle, json, readJson, requireUser } from '../../../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return handle(async()=>json({status:await getCourierStatus(await requireUser(request))})); }
export async function POST(request: Request) {
  return handle(async()=>{
    checkMutation(request);
    const actor=await requireUser(request),data=courierStatusSchema.parse(await readJson(request));
    return json({status:await setCourierStatus(actor,data)});
  });
}
