import {checkMutation,handle,json,readJson,requireUser} from '../../../../lib/http';
import {saveLocationSettings} from '../../../../lib/courier-location-settings';
import {getCourierStatus} from '../../../../lib/courier-status';
export const runtime='nodejs';
export async function GET(request:Request){return handle(async()=>json({status:await getCourierStatus(await requireUser(request))}));}
export async function POST(request:Request){return handle(async()=>{checkMutation(request);return json(await saveLocationSettings(await requireUser(request),await readJson(request)));});}
