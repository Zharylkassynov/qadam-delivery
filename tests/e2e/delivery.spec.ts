import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mockMapTiles } from './map-fixture';

const origin = process.env.E2E_ORIGIN ?? 'http://127.0.0.1:3100';

test.beforeEach(async ({ context }) => { await mockMapTiles(context); });

async function login(page: Page, email: string, waitForOrders = true) {
  await page.goto('/');
  await page.getByLabel('Логин', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(process.env.DEMO_PASSWORD!);
  const ordersLoaded = waitForOrders ? page.waitForResponse((response) => response.url().endsWith('/api/orders') && response.request().method() === 'GET') : undefined;
  await page.getByRole('button', { name: 'Войти в аккаунт', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
  if (ordersLoaded) {
    await ordersLoaded;
    await expect(page.getByRole('status', { name: 'Загружаем заказы' })).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Загружаем доставки…' })).toHaveCount(0);
  }
}

async function newDelivery(page: Page) {
  await expect(page.getByRole('heading', { name: /^(Куда доставить\?|Текущая доставка)$/ })).toBeVisible();
  if (await page.getByRole('heading', { name: 'Текущая доставка', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Новая доставка', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Куда доставить?', exact: true })).toBeVisible();
}

async function chooseRoute(page: Page, pickup: string, destination: string) {
  await page.getByRole('button', { name: 'Указать адреса', exact: true }).click();
  await page.getByLabel('Адрес отправления', { exact: true }).fill(pickup);
  const choose = page.getByRole('button', { name: 'Выбрать адрес', exact: true });
  await expect(choose).toBeInViewport();
  await choose.click();
  await page.getByLabel('Адрес доставки', { exact: true }).fill(destination);
  await choose.click();
  await expect(page.getByRole('main')).toContainText(pickup);
  await expect(page.getByRole('main')).toContainText(destination);
  await expect(page.getByRole('button', { name: 'Далее — получатель', exact: true })).toBeInViewport();
}

async function recipientForm(page: Page, pickup: string, destination: string) {
  await newDelivery(page);
  await chooseRoute(page, pickup, destination);
  await page.getByRole('button', { name: 'Далее — получатель', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Получатель и посылка', exact: true })).toBeVisible();
}

test('customer and courier complete a delivery; polling, reopening and history retain it', async ({ browser }, testInfo) => {
  const customerContext = await browser.newContext();
  const courierContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await mockMapTiles(customerContext);
  await mockMapTiles(courierContext);
  const customer = await customerContext.newPage();
  const courier = await courierContext.newPage();
  const pickup = `E2E ${randomUUID().slice(0, 8)}, улица Абая, 10`;
  try {
    await login(customer, 'customer1@qadam.demo');
    await login(courier, 'courier1@qadam.demo');
    await recipientForm(customer, pickup, 'Алматы, улица Ауэзова, 20');
    await customer.getByLabel('Имя получателя', { exact: true }).fill('Получатель автотеста');
    await customer.getByLabel('Телефон получателя', { exact: true }).fill('+7 700 123 45 67');
    await customer.getByLabel('Комментарий курьеру', { exact: true }).fill('Автоматическая проверка — не реальная доставка');
    await customer.getByRole('button', { name: 'Проверить заказ', exact: true }).click();
    await expect(customer.getByRole('heading', { name: 'Всё верно?', exact: true })).toBeVisible();
    await expect(customer.getByRole('main')).toContainText(pickup);
    await customer.getByRole('radio', { name: 'Получатель', exact: true }).check();
    await customer.getByRole('radio', { name: /Наличные/ }).check();
    await customer.getByRole('button', { name: 'Подтвердить заказ', exact: true }).click();
    await expect(customer.getByRole('status')).toContainText('Заказ создан');
    await expect(customer.getByText(/Платит получатель · наличными/)).toBeVisible();
    await customer.screenshot({ path: testInfo.outputPath('customer-desktop.png'), fullPage: true });
    const card = courier.getByRole('button', { name: /^Открыть заказ/ }).filter({ hasText: pickup });
    await expect(card).toBeVisible({ timeout: 20000 });
    const orderButton = (await card.getAttribute('aria-label'))!;
    await card.click();
    await expect(courier.getByText(/Платит получатель · наличными/)).toBeVisible();
    await courier.getByRole('button', { name: 'Принять заказ', exact: true }).click();
    await expect(courier.getByRole('button', { name: 'Посылка у меня', exact: true })).toBeInViewport();
    await courier.screenshot({ path: testInfo.outputPath('courier-mobile-accepted.png'), fullPage: true });
    const customerDetail = customer.getByRole('region', { name: 'Детали заказа' });
    await expect(customerDetail.locator('.status-badge')).toHaveText('Курьер назначен');
    await courier.getByRole('button', { name: 'Посылка у меня', exact: true }).click();
    await expect(customerDetail.locator('.status-badge')).toHaveText('Посылка у курьера');
    await courier.getByRole('button', { name: 'Начать доставку', exact: true }).click();
    await expect(customerDetail.locator('.status-badge')).toHaveText('В пути');
    await courier.screenshot({ path: testInfo.outputPath('courier-mobile-transit.png'), fullPage: true });
    await courier.getByRole('button', { name: 'Завершить доставку', exact: true }).click();
    await expect(customerDetail.getByRole('heading', { name: 'Посылка у получателя', exact: true })).toBeVisible();
    await courier.screenshot({ path: testInfo.outputPath('courier-mobile-delivered.png'), fullPage: true });
    await customer.close();
    const reopened = await customerContext.newPage();
    await reopened.goto('/');
    await expect(reopened.getByRole('heading', { name: /^(Куда доставить\?|Текущая доставка)$/ })).toBeVisible();
    await reopened.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Мои заказы', exact: true }).click();
    await reopened.getByRole('button', { name: 'Завершённые', exact: true }).click();
    await reopened.getByRole('button', { name: orderButton, exact: true }).click();
    const history = reopened.getByRole('region', { name: 'Детали заказа' });
    await expect(history.getByRole('heading', { name: 'Посылка у получателя', exact: true })).toBeVisible();
    await expect(history.locator('.timeline li')).toHaveCount(6);
    await expect(history.getByText(/Платит получатель · наличными/)).toBeVisible();
    // A fresh login also reconstructs history from the database.
    await reopened.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(reopened.getByLabel('Логин', { exact: true })).toBeVisible();
    await login(reopened, 'customer1@qadam.demo');
    await reopened.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Мои заказы', exact: true }).click();
    await reopened.getByRole('button', { name: 'Завершённые', exact: true }).click();
    await expect(reopened.getByRole('button', { name: orderButton, exact: true })).toBeVisible();
    await reopened.screenshot({ path: testInfo.outputPath('completed-history.png'), fullPage: true });
  } finally { await customerContext.close(); await courierContext.close(); }
});

test('HTTP API requires authentication, same-origin mutations and server-owned roles', async ({ request }) => {
  expect((await request.get('/api/orders')).status()).toBe(401);
  expect((await request.get('/api/map-config')).status()).toBe(401);
  expect((await request.get('/api/map-tiles/1/0/0')).status()).toBe(401);
  expect((await request.get(`/api/orders/${randomUUID()}/route`)).status()).toBe(401);
  expect((await request.post('/api/geocoding', { headers: { Origin: origin }, data: { query: 'Алматы, Абая 10' } })).status()).toBe(401);
  for (const blockedOrigin of [undefined, 'null', 'http://localhost:9999', 'https://localhost:3100', 'http://localhost.evil.invalid:3100']) {
    expect((await request.post('/api/auth/login', { headers: blockedOrigin ? { Origin: blockedOrigin } : {}, data: {} })).status()).toBe(403);
  }
  expect((await request.post('/api/auth/login', { headers: { Origin: 'https://untrusted.invalid' }, data: {} })).status()).toBe(403);
  const forged = await request.post('/api/auth/login', { headers: { Origin: origin }, data: { email: 'customer1@qadam.demo', password: process.env.DEMO_PASSWORD, role: 'COURIER' } });
  expect(forged.status()).toBe(400);
  const wrong = await request.post('/api/auth/login', { headers: { Origin: origin }, data: { email: 'customer1@qadam.demo', password: 'wrong' } });
  expect(wrong.status()).toBe(401);
  const loggedIn = await request.post('/api/auth/login', { headers: { Origin: origin }, data: { email: 'courier2@qadam.demo', password: process.env.DEMO_PASSWORD } });
  expect(loggedIn.status()).toBe(200);
  expect(loggedIn.headers()['set-cookie']).toContain('HttpOnly');
  expect(loggedIn.headers()['set-cookie']).toContain('SameSite=lax');
  if (new URL(origin).protocol === 'https:') expect(loggedIn.headers()['set-cookie']).toContain('Secure');
  expect((await loggedIn.json()).user.role).toBe('COURIER');
  expect((await request.post('/api/geocoding', { headers: { Origin: origin }, data: { query: 'Алматы, Абая 10' } })).status()).toBe(403);
  expect((await request.get('/api/map-tiles/20/0/0')).status()).toBe(400);
  const list = await request.get('/api/orders');
  expect(list.headers()['cache-control']).toContain('no-store');
  const attempt = await request.post('/api/orders', { headers: { Origin: origin }, data: { requestKey: randomUUID(), pickupAddress: 'Улица Абая, 10', destinationAddress: 'Улица Ауэзова, 20', recipientName: 'Тест', recipientPhone: '+77001234567', notes: '' } });
  expect(attempt.status()).toBe(403);
});

test('localhost alias supports browser login, session reload and logout', async ({ page }) => {
  test.skip(!['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Loopback alias is checked only on local servers');
  const alias = new URL(origin);
  alias.hostname = 'localhost';
  await page.goto(alias.origin);
  await page.getByLabel('Логин', { exact: true }).fill('customer2@qadam.demo');
  await page.getByLabel('Пароль', { exact: true }).fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button', { name: 'Войти в аккаунт', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
  expect((await page.request.get(`${alias.origin}/api/orders`)).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByLabel('Логин', { exact: true })).toBeVisible();
});

for (const width of [390, 360]) {
  test(`mobile layout at ${width}px fits the screen and keeps the form action visible`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await login(page, 'customer2@qadam.demo');
    await expect(page.getByRole('navigation', { name: 'Мобильная навигация' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await newDelivery(page);
    await expect(page.getByRole('button', { name: 'Указать адреса', exact: true })).toBeInViewport();
    const map = page.getByRole('region', { name: 'Карта доставки', exact: true });
    await expect(map).toBeVisible();
    await expect.poll(() => map.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(200);
    await expect(map.locator('.leaflet-tile-loaded').first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`customer-home-${width}.png`), fullPage: true });
    await chooseRoute(page, 'Алматы, проспект Абая, 10', 'Алматы, улица Ауэзова, 20');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect.poll(() => page.locator('img').evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`customer-route-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Далее — получатель', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Получатель и посылка', exact: true })).toBeVisible();
    const action = page.getByRole('button', { name: 'Проверить заказ', exact: true });
    await expect(action).toBeInViewport();
    await page.getByLabel('Комментарий курьеру', { exact: true }).scrollIntoViewIfNeeded();
    await expect(action).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.locator('img').evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`customer-form-${width}.png`), fullPage: true });
  });
}

test('review preserves the draft and a lost create response can be retried without a duplicate order', async ({ page }) => {
  await login(page, 'customer3@qadam.demo');
  const pickup = `E2E retry ${randomUUID().slice(0, 8)}, улица Абая, 27`;
  await recipientForm(page, pickup, 'Алматы, улица Ауэзова, 12');
  await page.getByRole('button', { name: 'Проверить заказ', exact: true }).click();
  await expect(page.getByLabel('Имя получателя', { exact: true })).toBeFocused();
  await expect(page.getByText('Укажите имя получателя — минимум 2 символа.', { exact: true })).toBeVisible();
  await page.getByLabel('Имя получателя', { exact: true }).fill('Получатель проверки повтора');
  await page.getByLabel('Телефон получателя', { exact: true }).fill('+7 700 000 00 00');
  await page.getByRole('button', { name: 'Документы', exact: true }).click();
  await page.getByLabel('О посылке', { exact: true }).fill('Конверт, тестовые документы');
  await page.getByLabel('Комментарий курьеру', { exact: true }).fill('E2E — не реальная доставка');
  await page.getByRole('button', { name: 'Изменить адрес отправления', exact: true }).click();
  await expect(page.getByLabel('Адрес отправления', { exact: true })).toHaveValue(pickup);
  const editedPickup = `${pickup}, подъезд 2`;
  await page.getByLabel('Адрес отправления', { exact: true }).fill(editedPickup);
  await page.getByRole('button', { name: 'Выбрать адрес', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Получатель и посылка', exact: true })).toBeVisible();
  await expect(page.getByLabel('Имя получателя', { exact: true })).toHaveValue('Получатель проверки повтора');
  await expect(page.getByLabel('Телефон получателя', { exact: true })).toHaveValue('+7 700 000 00 00');
  await expect(page.getByRole('button', { name: 'Изменить адрес отправления', exact: true })).toContainText(editedPickup);
  await page.getByRole('button', { name: 'Проверить заказ', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Всё верно?', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Изменить данные', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Изменить адрес отправления', exact: true })).toContainText(editedPickup);
  await expect(page.getByLabel('О посылке', { exact: true })).toHaveValue('Конверт, тестовые документы');
  await expect(page.getByRole('button', { name: 'Документы', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Проверить заказ', exact: true }).click();
  const requestKeys: string[] = [];
  await page.route('**/api/orders', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    requestKeys.push(route.request().postDataJSON().requestKey);
    if (requestKeys.length === 1) {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      return route.abort('connectionfailed');
    }
    return route.continue();
  });
  await page.getByRole('button', { name: 'Подтвердить заказ', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Нет связи с сервером');
  await expect(page.getByRole('heading', { name: 'Всё верно?', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Подтвердить заказ', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Заказ создан');
  expect(requestKeys).toHaveLength(2);
  expect(requestKeys[0]).toBe(requestKeys[1]);
  const { orders } = await (await page.request.get('/api/orders')).json();
  const saved = orders.filter((order: { pickupAddress: string }) => order.pickupAddress === editedPickup);
  expect(saved).toHaveLength(1);
  expect(saved[0].notes).toContain('Тип отправления: Документы');
  expect(saved[0].notes).toContain('О посылке: Конверт, тестовые документы');
});

test('loading, empty list and connection errors offer a working recovery action', async ({ page }, testInfo) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/orders', async (route) => {
    await pending;
    await route.fulfill({ json: { orders: [] } });
  });
  await login(page, 'customer2@qadam.demo', false);
  const loading = page.getByRole('status').filter({ hasText: 'Загружаем доставки…' });
  await expect(loading).toBeVisible();
  release();
  await expect(loading).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Куда доставить?', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Указать адреса', exact: true })).toBeVisible();
  await page.unroute('**/api/orders');
  await page.route('**/api/orders', (route) => route.abort('connectionfailed'));
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Данные не обновлены', { timeout: 20000 });
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Статусы могут быть устаревшими');
  await page.screenshot({ path: testInfo.outputPath('connection-error.png'), fullPage: true });
  await page.unroute('**/api/orders');
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});
