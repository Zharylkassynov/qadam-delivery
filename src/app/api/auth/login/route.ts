import { z } from 'zod';
import { login, logout, sessionCookie, sessionMaxAge } from '../../../../lib/auth';
import { checkMutation, cookieOptions, cookieToken, handle, json, readJson } from '../../../../lib/http';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  return handle(async () => {
    checkMutation(request);
    const input = z.object({ email: z.email().max(254).transform((s) => s.toLowerCase().trim()), password: z.string().min(1).max(200) }).strict().parse(await readJson(request));
    const { user, token } = await login(input.email, input.password);
    await logout(cookieToken(request));
    const response = json({ user });
    response.cookies.set(sessionCookie, token, { ...cookieOptions(), maxAge: sessionMaxAge });
    return response;
  });
}
