import { existsSync, readFileSync } from 'node:fs';
// Local configuration only. Token is read from .env.telegram, never from args.
const mode = process.argv[2];
if (!['check', 'connect', 'webhook'].includes(mode)) throw new Error('Usage: npm run telegram:check | npm run telegram:connect | npm run telegram:webhook');
process.loadEnvFile('.env.telegram');
const token = process.env.TELEGRAM_BOT_TOKEN;
const username = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '');
const origin = process.env.APP_ORIGIN;
if (!token || !/^\d+:[A-Za-z0-9_-]{30,}$/.test(token) || !username) throw new Error('Fill TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME in .env.telegram');
const url = new URL(origin ?? '');
if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('APP_ORIGIN must be the public HTTPS origin');
const generatedSecretPath = '.secrets/stage-2-telegram-webhook-secret';
const webhookSecret = existsSync(generatedSecretPath) ? readFileSync(generatedSecretPath, 'utf8').trim() : process.env.TELEGRAM_WEBHOOK_SECRET;
if (mode === 'webhook' && !/^[A-Za-z0-9_-]{32,256}$/.test(webhookSecret ?? '')) throw new Error('Set TELEGRAM_WEBHOOK_SECRET in .env.telegram; it must match Vercel Production');

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
  if (mode === 'webhook') {
    await call('setMyCommands', { commands: [{ command: 'start', description: 'Открыть Qadam Delivery' }] });
    await call('setWebhook', {
      url: `${origin}/api/telegram/webhook`, secret_token: webhookSecret,
      allowed_updates: ['message', 'callback_query', 'edited_message'], drop_pending_updates: true,
    });
  }
  const webhook = await call('getWebhookInfo');
  console.log(JSON.stringify({ webhookUrl: webhook.url, pendingUpdates: webhook.pending_update_count, lastErrorDate: webhook.last_error_date ?? null, allowedUpdates: webhook.allowed_updates ?? [] }));
  if (mode === 'webhook' && webhook.url !== `${origin}/api/telegram/webhook`) throw new Error('Webhook URL verification failed');
  const button = await call('getChatMenuButton');
  console.log(JSON.stringify({ menuType: button.type, menuUrl: button.web_app?.url ?? null }));
  // Telegram normalizes an origin to a URL with a trailing slash.
  if (mode === 'connect' && (button.type !== 'web_app' || new URL(button.web_app?.url ?? 'https://invalid.local').href !== url.href)) throw new Error('Menu button verification failed');
} catch (error) {
  // No raw network error objects: they can include the token in the request URL.
  console.error(error instanceof Error ? error.message.replaceAll(token, '[redacted]') : 'Telegram setup failed');
  process.exitCode = 1;
}
