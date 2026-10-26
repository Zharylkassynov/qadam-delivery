import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validWebhookSecret, updateSchema } from '../src/lib/telegram-bot';
import { validSource } from '../src/lib/courier-options';
import { botApi, BotApiError } from '../src/lib/telegram-bot-api';
import { readJson } from '../src/lib/http';
import { AppError } from '../src/lib/errors';
import { POST } from '../src/app/api/telegram/webhook/route';
import { testBotToken } from './telegram-fixture';

test('webhook secret rejects missing, malformed and same-length wrong values before accessing the database', async () => {
  const secret = 'a'.repeat(43);
  assert.equal(validWebhookSecret(secret, secret), true);
  for (const value of [null, '', 'b'.repeat(43), 'a'.repeat(42), `${secret} `]) assert.equal(validWebhookSecret(value, secret), false);
  assert.equal(validWebhookSecret(secret, ''), false);
  assert.equal(validWebhookSecret('short', 'short'), false);
  const old = process.env.TELEGRAM_WEBHOOK_SECRET;
  process.env.TELEGRAM_WEBHOOK_SECRET = secret;
  try {
    const response = await POST(new Request('https://qadam.example/api/telegram/webhook', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'b'.repeat(43) }, body: '{}' }));
    assert.equal(response.status, 401);
  } finally { if (old === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET; else process.env.TELEGRAM_WEBHOOK_SECRET = old; }
});

test('source labels are restricted and Telegram updates discard unrelated personal fields', () => {
  for (const source of ['courier', 'courier_uni', 'courier_ref_12', 'a'.repeat(64)]) assert.equal(validSource(source), source);
  for (const source of [null, undefined, '', '../courier', 'Courier', 'a'.repeat(65), 'courier?admin=1', 'курьер']) assert.equal(validSource(source), undefined);
  const parsed = updateSchema.parse({ update_id: 4, message: { message_id: 3, from: { id: 2, username: 'not-stored' }, chat: { id: 2, type: 'private', first_name: 'not-stored' }, text: '/start' }, ignored: true });
  assert.deepEqual(parsed, { update_id: 4, message: { message_id: 3, from: { id: 2 }, chat: { id: 2, type: 'private' }, text: '/start' } });
  for (const update_id of [-1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) assert.equal(updateSchema.safeParse({ update_id }).success, false);
});

test('JSON body limits count streamed bytes instead of trusting Content-Length', async () => {
  const text = JSON.stringify({ text: 'я'.repeat(18000) });
  const request = () => new Request('https://qadam.example', { method: 'POST', body: text, headers: { 'Content-Length': '1' } });
  await assert.rejects(readJson(request()), (error: unknown) => error instanceof AppError && error.status === 413);
  assert.deepEqual(await readJson(request(), 65536), JSON.parse(text));
  await assert.rejects(readJson(new Request('https://qadam.example', { method: 'POST', body: JSON.stringify({ text: 'x'.repeat(66000) }) }), 65536), (error: unknown) => error instanceof AppError && error.status === 413);
});

test('Bot API transport redacts raw network errors and preserves only retry metadata', async () => {
  const oldFetch = globalThis.fetch, oldToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = testBotToken;
  try {
    globalThis.fetch = async () => { throw new Error(`Network failure https://api.telegram.org/bot${testBotToken}/sendMessage`); };
    await assert.rejects(botApi('sendMessage', { chat_id: 123, text: 'Synthetic' }), (error: unknown) => error instanceof BotApiError && error.code === 503 && !String(error).includes(testBotToken));
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error_code: 429, description: `Do not expose ${testBotToken}`, parameters: { retry_after: 25 } }), { status: 429 });
    await assert.rejects(botApi('sendMessage', {}), (error: unknown) => error instanceof BotApiError && error.code === 429 && error.retryAfter === 25 && !String(error).includes(testBotToken));
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result: { message_id: 2 } }));
    assert.deepEqual(await botApi('sendMessage', {}), { message_id: 2 });
    await assert.rejects(botApi('getUpdates', {}), (error: unknown) => error instanceof BotApiError && error.code === 400);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = oldToken;
  }
});
