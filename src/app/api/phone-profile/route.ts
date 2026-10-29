import { handle,json,requireUser } from '../../../lib/http';
import { phoneProfile } from '../../../lib/user-profiles';
import { scheduleTelegramJobs } from '../../../lib/telegram-jobs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){return handle(async()=>{const profile=await phoneProfile(await requireUser(request));scheduleTelegramJobs();return json(profile);});}
