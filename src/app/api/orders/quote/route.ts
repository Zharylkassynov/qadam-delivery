import { createQuote,currentTariff } from '../../../../lib/order-quotes';
import { checkMutation,handle,json,readJson,requireUser } from '../../../../lib/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){return handle(async()=>{const tariff=await currentTariff(await requireUser(request));return json({enabled:!!tariff,transport:tariff?'CAR':null,...(tariff?.demonstration?{demonstration:true}:{})});});}
export async function POST(request:Request){return handle(async()=>{checkMutation(request);return json({quote:await createQuote(await requireUser(request),await readJson(request))},201);});}
