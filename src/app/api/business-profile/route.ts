import { businessProfile,businessProfileSchema,saveBusinessProfile,deleteBusinessProfile } from '../../../lib/business-profiles';
import { checkMutation,handle,json,readJson,requireUser } from '../../../lib/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){return handle(async()=>json({profile:await businessProfile(await requireUser(request))}));}
export async function PUT(request:Request){return handle(async()=>{checkMutation(request);const actor=await requireUser(request);const input=businessProfileSchema.parse(await readJson(request));return json({profile:await saveBusinessProfile(actor,input)});});}
export async function DELETE(request:Request){return handle(async()=>{checkMutation(request);await deleteBusinessProfile(await requireUser(request));return json({ok:true});});}
