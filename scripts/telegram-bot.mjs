// Local configuration only. Token is read from .env.telegram, never from args.
const mode = process.argv[2];
if (!['check', 'connect'].includes(mode)) throw new Error('Usage: npm run telegram:check | npm run telegram:connect');
process.loadEnvFile('.env.telegram');
const token = process.env.TELEGRAM_BOT_TOKEN;
const username = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '');
const origin = process.env.APP_ORIGIN;
if (!token || !/^\d+:[A-Za-z0-9_-]{30,}$/.test(token) || !username) throw new Error('Fill TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME in .env.telegram');
const url = new URL(origin ?? '');
if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('APP_ORIGIN must be the public HTTPS origin');

async function call(method, body = {}) {
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
  } catch { throw new Error(`Telegram ${method}: connection unavailable (request details redacted)`); }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(`Telegram ${method}: failed (${response.status}); details redacted`);
  return result.result;
}
try {
  const bot = await call('getMe');
  if (bot.username?.toLowerCase() !== username.toLowerCase()) throw new Error('The token belongs to a different bot; check the local configuration');
  console.log(`Verified bot: @${bot.username}`);
  if (mode === 'connect') {
    await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Открыть Qadam', web_app: { url: origin } } });
  }
  const button = await call('getChatMenuButton');
  console.log(JSON.stringify({ menuType: button.type, menuUrl: button.web_app?.url ?? null }));
  // Telegram normalizes an origin to a URL with a trailing slash.
  if (mode === 'connect' && (button.type !== 'web_app' || new URL(button.web_app?.url ?? 'https://invalid.local').href !== url.href)) throw new Error('Menu button verification failed');
} catch (error) {
  // No raw network error objects: they can include the token in the request URL.
  console.error(error instanceof Error ? error.message.replaceAll(token, '[redacted]') : 'Telegram setup failed');
  process.exitCode = 1;
}
