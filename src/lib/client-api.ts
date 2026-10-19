'use client';

// Mini App credentials stay only in memory, never in persistent browser storage.
let telegramSessionToken: string | undefined;
export const setTelegramSessionToken = (token: string | undefined) => { telegramSessionToken = token; };
export const sessionHeaders = (): Record<string, string> => telegramSessionToken ? { Authorization: `Bearer ${telegramSessionToken}` } : {};
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...sessionHeaders() },
      body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError('Нет связи с сервером. Проверьте подключение и повторите.', 0);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(result.error ?? 'Не удалось выполнить запрос.', response.status);
  return result as T;
}
