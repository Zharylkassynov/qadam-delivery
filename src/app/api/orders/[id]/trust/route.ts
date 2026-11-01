import {handle,json,requireUser} from '../../../../../lib/http';
import {orderTrustInfo} from '../../../../../lib/trust-info';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>json({trust:await orderTrustInfo(await requireUser(request),(await context.params).id)}));}
