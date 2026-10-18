import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from './errors';
import { getSession, sessionCookie } from './auth';
import { appOrigin } from './deployment-config';

export const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' },
});

export async function handle(work: () => Promise<Response>) {
  try { return await work(); }
  catch (error) {
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    if (error instanceof ZodError) return json({ error: 'Проверьте поля: адреса от 5 символов, имя от 2 символов и корректный телефон.' }, 400);
    if (error instanceof SyntaxError) return json({ error: 'Некорректный JSON.' }, 400);
    // Log a code, never a connection string, password or request body.
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
    console.error('Request failed:', code);
    return json({ error: 'Сервер временно недоступен. Проверьте подключение к базе и повторите.' }, 503);
  }
}

export function cookieToken(request: Request) {
  return request.headers.get('cookie')?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1);
}

export async function requireUser(request: Request) {
  const user = await getSession(cookieToken(request));
  if (!user) throw new AppError(401, 'Войдите в аккаунт.');
  return user;
}

export function checkMutation(request: Request) {
  const configured = new URL(appOrigin());
  const allowedOrigins = new Set([configured.origin]);
  // Local development uses two names for this computer; keep the port and protocol fixed.
  if (['localhost', '127.0.0.1'].includes(configured.hostname)) {
    const alias = new URL(configured.origin);
    alias.hostname = configured.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
    allowedOrigins.add(alias.origin);
  }
  if (!allowedOrigins.has(request.headers.get('origin') ?? '')) throw new AppError(403, 'Недопустимый источник запроса.');
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new AppError(415, 'Требуется application/json.');
}

export async function readJson(request: Request): Promise<unknown> {
  // Bound the actual streamed body, not just the caller-provided Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, 'Пустой запрос.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) { await reader.cancel(); throw new AppError(413, 'Слишком большой запрос.'); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function cookieOptions() {
  const origin = new URL(appOrigin());
  return { httpOnly: true, sameSite: 'lax' as const, secure: origin.protocol === 'https:', path: '/' };
}
