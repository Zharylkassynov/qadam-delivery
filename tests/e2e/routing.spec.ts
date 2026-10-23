import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mockMapTiles } from './map-fixture';

const origin = process.env.E2E_ORIGIN ?? 'http://127.0.0.1:3100';
const points = { pickupPoint: { latitude: 43.24189, longitude: 76.94684 }, destinationPoint: { latitude: 43.2398, longitude: 76.9239 } };
// Clearly simulated geometry; real Geoapify is checked separately with the server key.
const routeFixture = { route: { mode: 'drive', distanceMeters: 4277, paths: [[[43.24189, 76.94684], [43.2405, 76.94684], [43.2405, 76.9239], [43.2398, 76.9239]]] } };
const errors = new WeakMap<Page, string[]>();
function captureErrors(page: Page, found: string[]) {
  page.on('pageerror', e => found.push(e.message));
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('same key')) found.push(message.text()); });
}
test.beforeEach(({ page }) => { const found: string[] = []; errors.set(page, found); captureErrors(page, found); });
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });
async function login(page: Page, email: string) {
  await page.goto('/'); await page.getByLabel('Логин', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button', { name: 'Войти в аккаунт', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
}
async function enterOrders(page: Page) {
  await page.getByRole('navigation').getByRole('button', { name: /^(Заказы|Мои заказы)$/ }).click();
}
async function create(page: Page, pins = true) {
  const pickup = `E2E маршрут ${randomUUID().slice(0, 8)}, Абая 10`;
  const response = await page.request.post('/api/orders', { headers: { Origin: origin }, data: {
    requestKey: randomUUID(), pickupAddress: pickup, destinationAddress: 'Алматы, проспект Абая, 52', recipientName: 'Тест маршрута', recipientPhone: '+77000000000',
    notes: 'Автотест — маршрут и координаты симулированы, не реальная доставка', ...(pins ? points : {}),
  } }); expect(response.ok()).toBe(true); return { ...(await response.json()).order, pickup };
}

test('client and courier see the road route, retain it through status changes and reopen it in history', async ({ page, browser }, info) => {
  await mockMapTiles(page.context()); await page.setViewportSize({ width: 390, height: 844 });
  let requests = 0;
  await page.route('**/api/orders/*/route', async route => { requests++; await route.fulfill({ json: routeFixture }); });
  await login(page, 'customer1@qadam.demo'); const order = await create(page);
  await page.reload(); await enterOrders(page); await page.getByRole('button', { name: /^Открыть заказ/ }).filter({ hasText: order.pickup }).click();
  await expect(page.getByText('Автомаршрут · 4,3 км', { exact: true })).toBeVisible();
  await expect(page.locator('path.qadam-route-line')).toHaveCount(1);
  await expect(page.locator('.qadam-map-marker')).toHaveCount(2);
  await page.screenshot({ path: info.outputPath('route-customer-mobile.png') });
  const courierContext = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const courier = await courierContext.newPage(); await mockMapTiles(courierContext);
  const courierErrors: string[] = []; captureErrors(courier, courierErrors);
  let courierRequests = 0;
  await courier.route('**/api/orders/*/route', async route => { courierRequests++; await route.fulfill({ json: routeFixture }); });
  try {
    await login(courier, 'courier1@qadam.demo');
    await courier.getByRole('button', { name: /^Открыть заказ/ }).filter({ hasText: order.pickup }).click();
    await expect(courier.locator('path.qadam-route-line')).toHaveCount(1);
    await courier.getByRole('button', { name: 'Принять заказ', exact: true }).click();
    await courier.screenshot({ path: info.outputPath('route-courier-mobile.png') });
    for (const action of ['Посылка у меня', 'Начать доставку', 'Завершить доставку']) await courier.getByRole('button', { name: action, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Посылка у получателя', exact: true })).toBeVisible();
    // Polling and transitions must preserve the route without provider re-requests.
    expect(requests).toBe(1); expect(courierRequests).toBe(1);
    await page.reload();
    await enterOrders(page);
    await page.getByRole('button', { name: 'Завершённые', exact: true }).click();
    await page.getByRole('button', { name: /^Открыть заказ/ }).filter({ hasText: order.pickup }).click();
    await expect(page.locator('path.qadam-route-line')).toHaveCount(1); expect(requests).toBe(2);
    expect(courierErrors).toEqual([]);
  } finally { await courierContext.close(); }
});

test('route loading and retry preserve the order; missing coordinates do not trigger a route request', async ({ page }) => {
  await mockMapTiles(page.context()); await login(page, 'customer2@qadam.demo');
  const order = await create(page); let attempts = 0; let firstResponse: (() => void) | undefined;
  const release = new Promise<void>(resolve => { firstResponse = resolve; });
  await page.route('**/api/orders/*/route', async route => {
    attempts++; if (attempts === 1) { await release; await route.fulfill({ status: 503, json: { error: 'Тестовая ошибка сервиса маршрутов' } }); }
    else await route.fulfill({ json: routeFixture });
  });
  await page.reload(); await enterOrders(page); await page.getByRole('button', { name: /^Открыть заказ/ }).filter({ hasText: order.pickup }).click();
  await expect(page.getByText('Строим маршрут…', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Отменить заказ', exact: true })).toBeEnabled(); firstResponse!();
  await expect(page.getByText('Не удалось построить маршрут', { exact: true })).toBeVisible();
  await expect(page.locator('path.qadam-route-line')).toHaveCount(0);
  await page.getByRole('button', { name: 'Повторить маршрут', exact: true }).click();
  await expect(page.locator('path.qadam-route-line')).toHaveCount(1);
  expect((await page.request.post(`/api/orders/${order.id}/status`, { headers: { Origin: origin }, data: { status: 'CANCELLED' } })).ok()).toBe(true);
  const without = await create(page, false); await page.reload(); await enterOrders(page);
  await page.getByRole('button', { name: /^Открыть заказ/ }).filter({ hasText: without.pickup }).click();
  await expect(page.getByText('Точки ещё не указаны', { exact: true })).toBeVisible(); expect(attempts).toBe(2);
  expect((await page.request.post(`/api/orders/${without.id}/status`, { headers: { Origin: origin }, data: { status: 'CANCELLED' } })).ok()).toBe(true);
});
