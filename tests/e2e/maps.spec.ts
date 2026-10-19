import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mockMapTiles } from './map-fixture';

const origin = process.env.E2E_ORIGIN ?? 'http://127.0.0.1:3100';
async function login(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Логин', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button', { name: 'Войти в аккаунт', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
}

test('map pins and simulated GPS persist through delivery, stop on hide and show stale data honestly', async ({ browser }, testInfo) => {
  const customerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const courierContext = await browser.newContext({ viewport: { width: 360, height: 800 }, permissions: ['geolocation'], geolocation: { latitude: 43.241, longitude: 76.895, accuracy: 18 } });
  await mockMapTiles(customerContext); await mockMapTiles(courierContext);
  const customer = await customerContext.newPage(), courier = await courierContext.newPage();
  let locationPosts = 0;
  courier.on('request', (request) => { if (request.method() === 'POST' && /\/location$/.test(request.url())) locationPosts++; });
  const pickup = `E2E карта ${randomUUID().slice(0, 8)}, Алматы, Абая 10`;
  try {
    await login(customer, 'customer1@qadam.demo'); await login(courier, 'courier1@qadam.demo');
    await customer.getByRole('button', { name: 'Заказать доставку', exact: true }).click();
    await customer.getByLabel('Адрес отправления', { exact: true }).fill(pickup);
    await customer.getByRole('button', { name: 'Указать точку отправления', exact: true }).click();
    await expect(customer.getByRole('button', { name: 'Выбрать этот адрес', exact: true })).toBeDisabled();
    await customer.getByRole('button', { name: 'Выбрать точку в центре', exact: true }).click();
    await customer.screenshot({ path: testInfo.outputPath('point-picker-mobile.png') });
    await customer.getByRole('button', { name: 'Выбрать этот адрес', exact: true }).click();
    await expect(customer.getByText('А · точка отправления выбрана', { exact: true })).toBeVisible();
    // Editing an address invalidates its previous pin.
    await customer.getByLabel('Адрес отправления', { exact: true }).fill(`${pickup}, вход 2`);
    await expect(customer.getByRole('button', { name: 'Указать точку отправления', exact: true })).toBeVisible();
    await customer.getByRole('button', { name: 'Указать точку отправления', exact: true }).click();
    await customer.getByRole('button', { name: 'Выбрать точку в центре', exact: true }).click();
    await customer.getByRole('button', { name: 'Выбрать этот адрес', exact: true }).click();
    await customer.getByLabel('Адрес доставки', { exact: true }).fill('Алматы, улица Ауэзова, 20');
    await customer.getByRole('button', { name: 'Указать точку доставки', exact: true }).click();
    await expect(customer.getByRole('button', { name: 'Увеличить карту', exact: true })).toBeEnabled();
    await customer.locator('.delivery-map').click({ position: { x: 80, y: 160 } });
    await customer.getByRole('button', { name: 'Выбрать этот адрес', exact: true }).click();
    await customer.getByLabel('Имя получателя', { exact: true }).fill('Получатель теста карты');
    await customer.getByLabel('Телефон получателя', { exact: true }).fill('+7 700 000 00 00');
    await customer.getByLabel('Комментарий курьеру', { exact: true }).fill('Автотест: точки выбраны на карте, геопозиция курьера симулирована браузером.');
    await customer.getByRole('button', { name: 'Проверить заказ', exact: true }).click();
    await expect(customer.locator('.qadam-map-marker')).toHaveCount(2);
    const created = customer.waitForResponse((response) => response.url().endsWith('/api/orders') && response.request().method() === 'POST');
    await customer.getByRole('button', { name: 'Подтвердить заказ', exact: true }).click();
    const { order } = await (await created).json();
    expect(order.pickupPoint.latitude).toBeCloseTo(43.2389, 3); expect(order.destinationPoint).not.toEqual(order.pickupPoint);
    await expect(customer.locator('.qadam-map-marker')).toHaveCount(2);
    const card = courier.getByRole('button', { name: /^Открыть заказ/ }).filter({ hasText: pickup }); await card.click();
    await courier.getByRole('button', { name: 'Принять заказ', exact: true }).click();
    await courier.getByRole('button', { name: 'Передавать геопозицию', exact: true }).click();
    await expect(courier.getByText(/^Позиция сохранена:/)).toBeVisible();
    await expect(customer.locator('.qadam-map-marker.courier')).toHaveCount(1);
    await expect(customer.getByText('Точность: около 18 м.', { exact: false })).toBeVisible();
    await customer.screenshot({ path: testInfo.outputPath('tracking-customer-mobile.png') });
    const location = (await (await customer.request.get('/api/orders')).json()).orders.find((value: { id: string }) => value.id === order.id).courierLocation;
    expect(location.latitude).toBe(43.241); expect(location.longitude).toBe(76.895);
    // Simulate Mini App losing visibility. It must not silently restart on return.
    await courier.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(courier.getByRole('button', { name: 'Передавать геопозицию', exact: true })).toBeVisible();
    await courier.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    await courier.clock.install(); await courier.clock.fastForward(20000);
    expect(locationPosts).toBe(1);
    await customer.clock.install(); await customer.clock.fastForward(100000);
    await expect(customer.getByText('Позиция курьера устарела', { exact: true })).toBeVisible();
    for (const action of ['Посылка у меня', 'Начать доставку', 'Завершить доставку']) await courier.getByRole('button', { name: action, exact: true }).click();
    await expect(customer.getByRole('heading', { name: 'Посылка у получателя', exact: true })).toBeVisible();
    await customer.reload();
    await customer.getByRole('navigation', { name: 'Мобильная навигация' }).getByRole('button', { name: 'Заказы', exact: true }).click();
    await customer.getByRole('button', { name: 'Завершённые', exact: true }).click();
    await customer.getByRole('button', { name: /^Открыть заказ/ }).filter({ hasText: pickup }).click();
    await expect(customer.locator('.qadam-map-marker')).toHaveCount(3);
    await expect(customer.getByText('Доставка завершена · последняя точка', { exact: true })).toBeVisible();
    await expect(courier.getByRole('button', { name: 'Передавать геопозицию', exact: true })).toHaveCount(0);
  } finally { await customerContext.close(); await courierContext.close(); }
});

test('denied geolocation and tile outage preserve order actions', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await context.newPage();
  const pickup = `E2E отказ GPS ${randomUUID().slice(0, 8)}, Алматы, Абая 10`;
  await context.route('https://tile.openstreetmap.org/**', (route) => route.abort());
  await page.addInitScript(() => { navigator.geolocation.getCurrentPosition = (_success, failure) => failure?.({ code: 1, message: 'Test permission denied' } as GeolocationPositionError); });
  try {
    await login(page, 'customer2@qadam.demo');
    const created = await page.request.post('/api/orders', { headers: { Origin: origin }, data: { requestKey: randomUUID(), pickupAddress: pickup, destinationAddress: 'Алматы, Ауэзова 20', recipientName: 'Тест карты', recipientPhone: '+77000000000', notes: 'Автотест отказа GPS и карты', pickupPoint: { latitude: 43.2389, longitude: 76.8897 }, destinationPoint: null } });
    expect(created.ok()).toBe(true); const { order } = await created.json();
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await login(page, 'courier2@qadam.demo');
    await page.getByRole('button', { name: /^Открыть заказ/ }).filter({ hasText: pickup }).click();
    await page.getByRole('button', { name: 'Принять заказ', exact: true }).click();
    await expect(page.getByText('Карта недоступна', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Передавать геопозицию', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Доступ к геолокации не предоставлен');
    for (const action of ['Посылка у меня', 'Начать доставку', 'Завершить доставку']) await page.getByRole('button', { name: action, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Доставка завершена', exact: true })).toBeVisible();
    const persisted = (await (await page.request.get('/api/orders')).json()).orders.find((value: { id: string }) => value.id === order.id);
    expect(persisted.status).toBe('DELIVERED'); expect(persisted.courierLocation).toBeNull();
  } finally { await context.close(); }
});
