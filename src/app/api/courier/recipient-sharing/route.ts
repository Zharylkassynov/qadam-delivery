import {checkMutation,handle,json,readJson,requireUser} from '../../../../lib/http';
import {recipientPreference} from '../../../../lib/recipient-tracking';
export const runtime='nodejs';
export async function GET(request:Request){return handle(async()=>json(await recipientPreference(await requireUser(request))));}
export async function POST(request:Request){return handle(async()=>{checkMutation(request);return json(await recipientPreference(await requireUser(request),await readJson(request)));});}
