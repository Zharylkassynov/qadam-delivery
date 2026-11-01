import { test } from 'node:test';
import assert from 'node:assert/strict';
import { telegramLocationInput } from '../src/lib/telegram-location-input';

const now = Date.parse('2026-11-01T12:00:00Z'), date = now / 1000;
const message = () => ({ message_id: 31, date, from: { id: 123456, is_bot: false },
  chat: { id: 123456, type: 'private' },
  location: { latitude: 43.24, longitude: 76.9, horizontal_accuracy: 24, live_period: 900 } });
const initial = () => ({ update_id: 41, message: message() });
const edited = () => ({ update_id: 42, edited_message: { ...message(), date: date - 600, edit_date: date } });

test('own private live location yields only bounded protocol fields', () => {
  const result = telegramLocationInput(initial(), now);
  assert.deepEqual(result, { updateId: 41, telegramId: '123456', messageId: 31, edited: false,
    state: 'LIVE', sentAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 900000).toISOString(), latitude: 43.24, longitude: 76.9, accuracy: 24 });
});

test('edits use edit time for freshness but expiry remains relative to original message', () => {
  const result = telegramLocationInput(edited(), now)!;
  assert.equal(result.edited, true); assert.equal(result.state, 'LIVE');
  assert.equal(result.updatedAt, new Date(now).toISOString());
  assert.equal(result.expiresAt, new Date(now + 300000).toISOString());
});

test('a static point is never classified as a live stream or automatic tracking consent', () => {
  const point: Record<string, unknown> = { ...message().location }; delete point.live_period;
  const result = telegramLocationInput({ update_id: 1, message: { ...message(), location: point } }, now)!;
  assert.equal(result.state, 'STATIC'); assert.equal(result.expiresAt, null);
  assert.equal(Object.hasOwn(result, 'consent'), false);
});

test('a stopped edit remains static; callers must match a previously bound message to treat it as stop', () => {
  const point = { latitude: 43.24, longitude: 76.9 };
  const result = telegramLocationInput({ update_id: 42, edited_message: { ...edited().edited_message, location: point } }, now)!;
  assert.equal(result.edited, true); assert.equal(result.state, 'STATIC'); assert.equal(result.accuracy, null);
});

test('an expired live period cannot refresh tracking even with a recent edit', () => {
  const result = telegramLocationInput({ update_id: 42, edited_message: { ...edited().edited_message, date: date - 901 } }, now)!;
  assert.equal(result.state, 'EXPIRED');
});

test('rejects other senders, groups, bot senders, forwarded messages and venues', () => {
  for (const patch of [
    { from: { id: 999 } }, { chat: { id: -123, type: 'group' } }, { chat: { id: 123456, type: 'supergroup' } },
    { from: { id: 123456, is_bot: true } }, { forward_origin: {} }, { via_bot: {} }, { sender_chat: {} },
    { venue: {} }, { is_automatic_forward: true },
  ]) assert.equal(telegramLocationInput({ update_id: 1, message: { ...message(), ...patch } }, now), null);
});

test('rejects late, future, malformed and ambiguous events', () => {
  for (const input of [
    {}, { update_id: -1, message: message() }, { ...initial(), edited_message: edited().edited_message },
    { update_id: 1, message: { ...message(), date: date - 91 } },
    { update_id: 1, message: { ...message(), date: date + 31 } },
    { update_id: 1, edited_message: message() },
    { update_id: 1, edited_message: { ...message(), edit_date: date - 1 } },
    { update_id: 1, message: { ...message(), edit_date: date } },
    { update_id: 1, message: { ...message(), message_id: Number.MAX_SAFE_INTEGER } },
  ]) assert.equal(telegramLocationInput(input, now), null);
  assert.equal(telegramLocationInput(initial(), Number.NaN), null);
});

test('enforces coordinate, accuracy and duration ranges including indefinite Telegram streams', () => {
  for (const patch of [{ latitude: 91 }, { longitude: -181 }, { horizontal_accuracy: -1 },
    { horizontal_accuracy: 1501 }, { live_period: 0 }, { live_period: 59 }, { live_period: 86401 }, { live_period: 1.5 }]) {
    assert.equal(telegramLocationInput({ update_id: 1, message: { ...message(), location: { ...message().location, ...patch } } }, now), null);
  }
  assert.equal(telegramLocationInput({ update_id: 1, message: { ...message(), location: { ...message().location, live_period: 2147483647 } } }, now)?.state, 'LIVE');
});

test('strips unrelated personal data from extracted result', () => {
  const result = telegramLocationInput({ ...initial(), message: { ...message(), text: 'private text', contact: { phone_number: 'private-phone' }, from: { id: 123456, username: 'private-name' } } }, now)!;
  assert.ok(result); assert.ok(!JSON.stringify(result).includes('private-'));
});
