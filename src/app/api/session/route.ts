import { getSession } from '../../../lib/auth';
import { cookieToken, handle, json } from '../../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(async () => json({ user: await getSession(cookieToken(request)), demo: process.env.DEMO_AUTH_ENABLED === 'true' }));
}
