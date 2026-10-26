import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { signedTelegramData } from '../telegram-fixture';
import { miniApp } from './telegram-browser-fixture';
import { mockMapTiles } from './map-fixture';

test.skip(Boolean(process.env.E2E_ORIGIN), 'Synthetic Telegram accounts are local-test fixtures only');
const origin = 'http://127.0.0.1:3100';
const profile = (page: Page) => page.getByRole('navigation', { name: 'Мобильная навигация' }).getByRole('button', { name: 'Профиль', exact: true });

test('Telegram administrator observes self-accepted delivery, history, search, pagination and revoked access without cookies', async ({ browser, request }, info) => {
  test.setTimeout(180000);
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Admin fixture requires a separate _test DB');
  const db = new pg.Client({ connectionString: url }); await db.connect();
  const marker = `E2E-наблюдение-${randomUUID().slice(0, 8)}`;
  async function account(name: string) {
    const proof = signedTelegramData({ id: 4200000000000 + Math.floor(Math.random() * 1000000000), first_name: name });
    const response = await request.post('/api/auth/telegram', { headers: { Origin: origin }, data: { initData: proof } });
    expect(response.status()).toBe(200); const data = await response.json(); return { ...data, token: data.sessionToken, proof };
  }
  const adminAccount = await account('Наблюдатель E2E'), clientAccount = await account('Клиент наблюдения E2E'), courierAccount = await account('Курьер наблюдения E2E');
  const headers = (token: string) => ({ Authorization: `Bearer ${token}`, Origin: origin });
  await db.query('INSERT INTO qadam.administrators(user_id) VALUES($1)', [adminAccount.user.id]);
  const application = await request.post('/api/courier-application', { headers: headers(courierAccount.token), data: { phone: '+77000000000', transport: 'ELECTRIC_MOPED', notes: 'Автотест — вымышленные данные', district: 'ALMALY', availability: ['EVENING'], ageConfirmed: true, acceptRules: true } });
  expect(application.status()).toBe(201);
  const applicationId = (await application.json()).application.id;
  expect((await request.post(`/api/admin/courier-applications/${applicationId}`, { headers: headers(adminAccount.token), data: { decision: 'APPROVED', reason: '' } })).status()).toBe(200);
  const payload = { requestKey: randomUUID(), pickupAddress: `${marker}, проспект Абая, 10`, destinationAddress: 'проспект Абая, 52', recipientName: 'Тестовый получатель', recipientPhone: '+77000000000', notes: 'Автотест — не реальная доставка', pickupPoint: { latitude: 43.24189, longitude: 76.94684 }, destinationPoint: { latitude: 43.2398, longitude: 76.9239 } };
  const response = await request.post('/api/orders', { headers: headers(clientAccount.token), data: payload }); expect(response.status()).toBe(201);
  const { order } = await response.json();
  // More than one page proves that observation is not limited to the newest 20.
  for (let i = 0; i < 20; i++) expect((await request.post('/api/orders', { headers: headers(clientAccount.token), data: { ...payload, requestKey: randomUUID(), pickupAddress: `${marker}, тест ${i}, Абая 10` } })).status()).toBe(201);
  const number = `QD-${order.number.padStart(4, '0')}`;
  const anon = await browser.newContext();
  expect((await anon.request.get(`${origin}/api/admin/orders`)).status()).toBe(401); await anon.close();
  expect((await request.get('/api/admin/orders', { headers: headers(clientAccount.token) })).status()).toBe(403);
  expect((await request.get(`/api/admin/orders/${order.id}`, { headers: headers(courierAccount.token) })).status()).toBe(403);
  expect((await request.post(`/api/admin/orders/${order.id}`, { headers: headers(adminAccount.token), data: { courierId: courierAccount.user.id } })).status()).toBe(405);
  expect((await request.post(`/api/orders/${order.id}/accept`, { headers: headers(adminAccount.token), data: {} })).status()).toBe(403);
  const permitted = await request.get(`/api/admin/orders/${order.id}`, { headers: headers(adminAccount.token) });
  expect(permitted.headers()['cache-control']).toContain('private, no-store');
  const contexts = await Promise.all([1, 2, 3].map(() => browser.newContext({ viewport: { width: 390, height: 844 } })));
  const [admin, client, courier] = await Promise.all(contexts.map(c => c.newPage()));
  const errors: string[] = []; for (const p of [admin, client, courier]) p.on('pageerror', e => errors.push(e.message));
  for (const c of contexts) await mockMapTiles(c);
  try {
    await miniApp(admin, adminAccount.proof, 844); await miniApp(client, clientAccount.proof, 844); await miniApp(courier, courierAccount.proof, 844);
    for (const p of [admin, client, courier]) await p.route('**/api/orders/*/route', route => route.fulfill({ json: { route: { mode: 'drive', distanceMeters: 4277, paths: [[[43.24189, 76.94684], [43.24, 76.94], [43.2398, 76.9239]]] } } }));
    await profile(client).click(); await expect(client.getByRole('button', { name: 'Все заказы', exact: true })).toHaveCount(0);
    await profile(admin).click(); await admin.getByRole('button', { name: 'Все заказы', exact: true }).click();
    await admin.getByLabel('Найти заказ').fill(marker);
    await expect(admin.locator('.admin-order-list .order-card')).toHaveCount(20);
    await admin.getByRole('button', { name: 'Показать ещё', exact: true }).click();
    await expect(admin.locator('.admin-order-list .order-card')).toHaveCount(21);
    await expect(admin.getByRole('button', { name: 'Показать ещё', exact: true })).toHaveCount(0);
    for (const width of [320, 360, 390, 1440]) {
      await admin.setViewportSize({ width, height: 844 });
      expect(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const columns = await admin.locator('.admin-order-list').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expect(columns).toBe(width < 960 ? 1 : 3);
      await admin.getByRole('heading', { name: 'Диспетчерская', exact: true }).scrollIntoViewIfNeeded();
      if (width === 390 || width === 1440) await admin.screenshot({ path: info.outputPath(`admin-orders-${width}.png`) });
    }
    await admin.setViewportSize({ width: 390, height: 844 });
    await admin.getByLabel('Найти заказ').fill(number);
    await expect(admin.locator('.admin-order-list .order-card')).toHaveCount(1);
    await admin.getByRole('button', { name: `Открыть заказ ${number}`, exact: true }).click();
    await expect(admin.getByRole('heading', { name: 'Ожидает курьера', exact: true })).toBeVisible();
    await expect(admin.getByRole('button', { name: /Назначить|Сменить курьера|Принять заказ|Посылка у меня|Передавать геопозицию/ })).toHaveCount(0);
    await courier.getByRole('button', { name: `Открыть заказ ${number}`, exact: true }).click();
    await courier.getByRole('button', { name: 'Принять заказ', exact: true }).click();
    await expect(admin.getByRole('heading', { name: 'Курьер забирает посылку', exact: true })).toBeVisible();
    await expect(admin.getByText('Электромопед', { exact: true })).toBeVisible();
    await expect(admin.getByText('Автомаршрут · 4,3 км', { exact: true })).toBeVisible();
    await expect(admin.locator('path.qadam-route-line')).toHaveCount(1);
    await courier.getByRole('button', { name: 'Передавать геопозицию', exact: true }).click();
    await expect(courier.getByText(/^Позиция сохранена:/)).toBeVisible();
    await expect(admin.getByText('Последняя позиция курьера', { exact: true })).toBeVisible();
    await expect(admin.locator('.qadam-map-marker')).toHaveCount(3);
    await courier.getByRole('button', { name: /^Остановить/ }).click();
    await db.query("UPDATE qadam.courier_locations SET captured_at=now()-interval '95 seconds' WHERE order_id=$1", [order.id]);
    await expect(admin.getByText('Позиция курьера устарела', { exact: true })).toBeVisible();
    await admin.screenshot({ path: info.outputPath('admin-order-stale-position.png') });
    for (const [action, title] of [['Посылка у меня', 'Посылка у курьера'], ['Начать доставку', 'Посылка в пути'], ['Завершить доставку', 'Доставка завершена']]) {
      await courier.getByRole('button', { name: action, exact: true }).click();
      await expect(admin.getByRole('heading', { name: title, exact: true })).toBeVisible();
    }
    await expect(admin.getByRole('region', { name: 'История статусов' })).toContainText('Курьер наблюдения E2E');
    await admin.reload(); await profile(admin).click(); await admin.getByRole('button', { name: 'Все заказы', exact: true }).click();
    await admin.getByLabel('Найти заказ').fill(number); await admin.getByRole('button', { name: 'История', exact: true }).click();
    await expect(admin.locator('.admin-order-list .order-card')).toHaveCount(1);
    await admin.getByRole('button', { name: `Открыть заказ ${number}`, exact: true }).click();
    await expect(admin.getByRole('heading', { name: 'Доставка завершена', exact: true })).toBeVisible();
    await admin.getByRole('button', { name: 'К списку заказов', exact: true }).click();
    await admin.getByLabel('Найти заказ').fill('не-существует-'+marker);
    await expect(admin.getByRole('heading', { name: 'Ничего не найдено', exact: true })).toBeVisible();
    await admin.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
    await expect(admin.locator('.admin-order-list .order-card').first()).toBeVisible();
    await admin.route('**/api/admin/orders?*', route => route.fulfill({ status: 503, json: { error: 'Тестовая ошибка соединения' } }));
    await admin.getByRole('button', { name: 'Обновить список', exact: true }).click();
    await expect(admin.getByRole('main').getByRole('alert')).toContainText('Тестовая ошибка соединения');
    await expect(admin.locator('.admin-order-list .order-card').first()).toBeVisible();
    await admin.unroute('**/api/admin/orders?*'); await admin.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(admin.getByRole('main').getByRole('alert')).toHaveCount(0);
    await db.query('DELETE FROM qadam.administrators WHERE user_id=$1', [adminAccount.user.id]);
    await expect(admin.getByRole('main').getByRole('alert')).toContainText('Раздел недоступен');
    await expect(admin.locator('.admin-order-list .order-card')).toHaveCount(0);
    expect((await request.get(`/api/admin/orders/${order.id}`, { headers: headers(adminAccount.token) })).status()).toBe(403);
    expect((await request.get(`/api/orders/${order.id}/route`, { headers: headers(clientAccount.token) })).status()).toBe(503); // Own delivery is still authorized, provider disabled locally.
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(c => c.close())); await db.end(); }
});
