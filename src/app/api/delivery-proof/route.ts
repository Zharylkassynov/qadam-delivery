import {handle,json,requireUser} from '../../../lib/http';
import {proofEnabled} from '../../../lib/proof-settings';
export const runtime='nodejs';
export async function GET(request:Request){return handle(async()=>{await requireUser(request);return json({enabled:proofEnabled()});});}
