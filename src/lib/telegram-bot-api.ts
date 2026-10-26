export type BotTransport = (method: string, body: Record<string, unknown>) => Promise<unknown>;
export class BotApiError extends Error {
  constructor(public code: number, public retryAfter = 0) { super(`Telegram API unavailable (${code})`); }
}

// Never expose a raw fetch error: its URL can contain the bot token.
export const botApi: BotTransport = async (method, body) => {
  if (!['sendMessage', 'editMessageText', 'answerCallbackQuery'].includes(method)) throw new BotApiError(400);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) throw new BotApiError(503);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true) throw new BotApiError(Number(result?.error_code) || response.status, Math.min(3600, Math.max(0, Number(result?.parameters?.retry_after) || 0)));
    return result.result;
  } catch (error) { if (error instanceof BotApiError) throw error; throw new BotApiError(503); }
};
