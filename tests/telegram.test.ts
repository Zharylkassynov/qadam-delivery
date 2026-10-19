import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyTelegramData } from '../src/lib/telegram';
import { requestToken } from '../src/lib/http';
import { AppError } from '../src/lib/errors';
import { signedTelegramData, testBotToken } from './telegram-fixture';

const user = { id: 4503599627370495, first_name: 'Әлия', last_name: 'Тест', username: 'customer', role: 'COURIER' };
const rejects = (raw: string) => assert.throws(() => verifyTelegramData(raw, testBotToken), (error: unknown) => error instanceof AppError && error.status === 401);

test('Telegram HMAC handles Unicode, 52-bit IDs and signed extra fields without accepting a role', () => {
  const data = signedTelegramData(user, { signature: 'signed-additional-field', start_param: 'courier' });
  assert.deepEqual(verifyTelegramData(data, testBotToken), { id: '4503599627370495', name: 'Әлия Тест' });
});
test('Telegram rejects tampering, another bot key and duplicate parameters', () => {
  const data = signedTelegramData(user);
  const changed = new URLSearchParams(data);
  changed.set('user', JSON.stringify({ ...user, id: 123 }));
  rejects(changed.toString());
  rejects(signedTelegramData(user, {}, `${testBotToken}wrong`));
  rejects(`${data}&user=${encodeURIComponent(JSON.stringify(user))}`);
  rejects(`${data}&hash=${'0'.repeat(64)}`);
  rejects('hash=nope');
});
test('Telegram rejects expired and future proof, malformed users and unsafe identifiers', () => {
  const now = Math.floor(Date.now() / 1000);
  rejects(signedTelegramData(user, { auth_date: String(now - 3601) }));
  rejects(signedTelegramData(user, { auth_date: String(now + 60) }));
  rejects(signedTelegramData(user, { auth_date: '1e9' }));
  rejects(signedTelegramData(user, { user: '{broken' }));
  for (const id of [0, -1, 1.5, '123', 2 ** 52, null]) rejects(signedTelegramData({ ...user, id }));
  rejects(signedTelegramData({ ...user, is_bot: true }));
  rejects(signedTelegramData({ ...user, first_name: '' }));
});
test('explicit bearer sessions override cookies, including malformed bearer attempts', () => {
  const cookie = 'a'.repeat(64), bearer = 'b'.repeat(64);
  const req = (authorization?: string) => new Request('https://qadam.example/api/session', { headers: { cookie: `qadam_session=${cookie}`, ...(authorization === undefined ? {} : { authorization }) } });
  assert.equal(requestToken(req()), cookie);
  assert.equal(requestToken(req(`Bearer ${bearer}`)), bearer);
  assert.equal(requestToken(req('Bearer forged')), undefined);
  assert.equal(requestToken(req('Basic forged')), undefined);
});
