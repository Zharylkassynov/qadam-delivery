import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { miniApp } from '../e2e/telegram-browser-fixture';
import { signedTelegramData } from '../telegram-fixture';
import { mockMapTiles } from '../e2e/map-fixture';

const api = 'http://127.0.0.1:3102';
const frontend = 'http://127.0.0.1:3103';

test('frontend exposes no API; the standalone API preserves CORS, authentication and streamed body limits', async ({ request }) => {
  expect((await request.get('/api/session')).status()).toBe(404);
  expect((await request.get(`${api}/health`)).status()).toBe(200);
  expect((await request.get(`${api}/api/orders`, { headers: { Origin: frontend } })).status()).toBe(401);
  const allowed = await request.fetch(`${api}/api/auth/telegram`, { method: 'OPTIONS', headers: {
    Origin: frontend, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type',
  } });
  expect(allowed.status()).toBe(204);
  expect(allowed.headers()['access-control-allow-origin']).toBe(frontend);
  for (const origin of ['null', 'https://evil.example', `${frontend}.evil.example`]) {
    const forbidden = await request.get(`${api}/api/session`, { headers: { Origin: origin } });
    expect(forbidden.status()).toBe(403);
    expect(forbidden.headers()['access-control-allow-origin']).toBeUndefined();
  }
  expect((await request.post(`${api}/api/auth/telegram`, { headers: { Origin: frontend }, data: { initData: 'x'.repeat(17000) } })).status()).toBe(413);
  expect((await request.post(`${api}/api/auth/telegram`, { headers: { Origin: frontend }, data: { initData: 'forged' } })).status()).toBe(401);
  expect((await request.post(`${api}/api/telegram/webhook`, { data: { update_id: 1 } })).status()).toBe(401);
});

test('Mini App completes a delivery through a separate API without cookies and restores it after reload', async ({ page, playwright }, testInfo) => {
  await mockMapTiles(page.context());
  const proof = signedTelegramData({ id: 7400000000000 + Math.floor(Math.random() * 1000000000), first_name: 'Отдельный API' });
  const loginResponse = page.waitForResponse(response => response.url() === `${api}/api/auth/telegram` && response.request().method() === 'POST');
  await miniApp(page, proof);
  expect((await loginResponse).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Куда доставить?', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Указать адреса', exact: true }).click();
  const pickup = `Алматы, отдельный API ${randomUUID().slice(0, 6)}`;
  await page.getByLabel('Адрес отправления', { exact: true }).fill(pickup);
  await page.getByRole('button', { name: 'Выбрать адрес', exact: true }).click();
  await page.getByLabel('Адрес доставки', { exact: true }).fill('Алматы, улица Абая, 20');
  await page.getByRole('button', { name: 'Выбрать адрес', exact: true }).click();
  await page.getByRole('button', { name: 'Далее — получатель', exact: true }).click();
  await page.getByLabel('Имя получателя', { exact: true }).fill('Проверка отдельного API');
  await page.getByLabel('Телефон получателя', { exact: true }).fill('+7 700 000 00 00');
  await page.getByRole('button', { name: 'Проверить заказ', exact: true }).click();
  const created = page.waitForResponse(response => response.url() === `${api}/api/orders` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Подтвердить заказ', exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  expect((await response.request().allHeaders()).authorization).toMatch(/^Bearer /);
  const { order } = await response.json();
  const courier = await playwright.request.newContext({ baseURL: api, extraHTTPHeaders: { Origin: frontend } });
  try {
    expect((await courier.post('/api/auth/login', { data: { email: 'courier1@qadam.demo', password: process.env.DEMO_PASSWORD } })).status()).toBe(200);
    expect((await courier.post('/api/courier/status', { data: { online: true } })).status()).toBe(200);
    expect((await (await courier.get('/api/courier/status')).json()).status.online).toBe(true);
    expect((await (await courier.get(`/api/orders/${order.id}`)).json()).order.recipientPhone).toBeNull();
    expect((await courier.post(`/api/orders/${order.id}/accept`, { data: {} })).status()).toBe(200);
    for (const status of ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED']) {
      expect((await courier.post(`/api/orders/${order.id}/status`, { data: { status } })).status()).toBe(200);
    }
    expect((await (await courier.get(`/api/orders/${order.number}`)).json()).order.status).toBe('DELIVERED');
    expect((await courier.post('/api/courier/status', { data: { online: false } })).status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Посылка у получателя', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('separate-api-delivered.png'), fullPage: true });
    await page.reload();
    await page.getByRole('navigation', { name: 'Мобильная навигация', exact: true }).getByRole('button', { name: 'Заказы', exact: true }).click();
    await page.getByRole('button', { name: 'Завершённые', exact: true }).click();
    await expect(page.getByRole('main')).toContainText(pickup);
    expect(await page.context().cookies()).toHaveLength(0);
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  } finally { await courier.dispose(); }
});

test('separate API failure is visible and the interface can recover', async ({ page }) => {
  await mockMapTiles(page.context());
  await miniApp(page, signedTelegramData({ id: 7500000000000 + Math.floor(Math.random() * 1000000000), first_name: 'Восстановление API' }));
  await expect(page.getByRole('heading', { name: 'Куда доставить?', exact: true })).toBeVisible();
  let unavailable = true;
  await page.route(`${api}/api/orders`, route => unavailable ? route.abort() : route.continue());
  await page.reload();
  const error = page.getByRole('main').getByRole('alert');
  await expect(error).toContainText('Нет связи с сервером');
  unavailable = false;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(error).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Куда доставить?', exact: true })).toBeVisible();
});
