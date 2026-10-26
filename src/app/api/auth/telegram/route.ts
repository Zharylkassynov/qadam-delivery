import { z } from 'zod';
import { loginTelegram, logout } from '../../../../lib/auth';
import { checkMutation, handle, json, readJson } from '../../../../lib/http';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  return handle(async () => {
    checkMutation(request);
    const input = z.object({ initData: z.string().min(1).max(12000) }).strict().safeParse(await readJson(request));
    if (!input.success) return json({ error: 'Не переданы корректные данные входа из Telegram.' }, 400);
    const { user, token, source, startScreen } = await loginTelegram(input.data.initData);
    // Rotate only an explicit Mini App session; do not log out a web account.
    const previous = /^Bearer ([a-f0-9]{64})$/i.exec(request.headers.get('authorization') ?? '')?.[1];
    await logout(previous?.toLowerCase());
    // Memory-only bearer transport works in Telegram Web without third-party cookies.
    return json({ user, sessionToken: token, source, startScreen });
  });
}
