import { createHmac } from 'node:crypto';

// Synthetic local tests only. Never use this key on the public deployment.
export const testBotToken = '123456789:local_test_only_abcdefghijklmnopqrstuvwxyz';
export function signedTelegramData(user: Record<string, unknown>, extra: Record<string, string> = {}, token = testBotToken) {
  const fields = new URLSearchParams({ user: JSON.stringify(user), auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'synthetic-test-query', ...extra });
  const check = [...fields].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  fields.set('hash', createHmac('sha256', key).update(check).digest('hex'));
  return fields.toString();
}
