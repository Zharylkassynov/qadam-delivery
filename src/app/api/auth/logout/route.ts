import { logout, sessionCookie } from '../../../../lib/auth';
import { checkMutation, cookieOptions, cookieToken, handle, json } from '../../../../lib/http';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  return handle(async () => {
    checkMutation(request);
    await logout(cookieToken(request));
    const response = json({ ok: true });
    response.cookies.set(sessionCookie, '', { ...cookieOptions(), maxAge: 0 });
    return response;
  });
}
