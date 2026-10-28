import { updateCourierPresence } from '../../../../lib/courier-presence';
import { checkMutation,handle,json,readJson,requireUser } from '../../../../lib/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request: Request) {
  return handle(async()=>{checkMutation(request);const actor=await requireUser(request);return json(await updateCourierPresence(actor,await readJson(request)));});
}
