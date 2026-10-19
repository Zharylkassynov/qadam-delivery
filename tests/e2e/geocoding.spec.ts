import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mockMapTiles } from './map-fixture';

const origin = process.env.E2E_ORIGIN ?? 'http://127.0.0.1:3100';
const house = { id: 'ab-market-10', address: 'проспект Абая, 10', detail: 'Алматы', precision: 'building', latitude: 43.24189, longitude: 76.94684 };
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const errors: string[] = []; pageErrors.set(page, errors); page.on('pageerror', (error) => errors.push(error.stack ?? error.message)); });
test.afterEach(({ page }) => { expect(pageErrors.get(page)).toEqual([]); });
async function login(page: Page) {
  await page.goto('/'); await page.getByLabel('Логин', { exact: true }).fill('customer2@qadam.demo');
  await page.getByLabel('Пароль', { exact: true }).fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button', { name: 'Войти в аккаунт', exact: true }).click();
  await page.getByRole('button', { name: 'Заказать доставку', exact: true }).click();
}

test('address search auto-locates one house, moves the map, saves both coordinates and preserves them after reopening', async ({ page, context }, info) => {
  await mockMapTiles(context);
  await page.route('**/api/map-config', (route) => route.fulfill({ json: { provider: 'geoapify', tileUrl: '/api/map-tiles/{z}/{x}/{y}', maxZoom: 19 } }));
  const queries: string[] = [];
  await page.route('**/api/geocoding', (route) => { const query = route.request().postDataJSON().query; queries.push(query); return route.fulfill({ json: { results: query.includes('Ауэзова') ? [{ ...house, id: 'auezov-20', address: 'улица Ауэзова, 20', latitude: 43.19883, longitude: 76.84452 }] : [house] } }); });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByLabel('Адрес отправления', { exact: true }).fill('Алматы, Абая 10');
  await page.getByRole('button', { name: 'Найти отправление на карте', exact: true }).click();
  await expect(page.getByText('Дом найден автоматически', { exact: true })).toBeVisible();
  await expect(page.locator('.qadam-map-marker.pickup')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Geoapify', exact: true }).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('automatic-address-mobile.png') });
  await page.getByRole('button', { name: 'Выбрать этот адрес', exact: true }).click();
  await expect(page.getByLabel('Адрес отправления', { exact: true })).toHaveValue('проспект Абая, 10, Алматы');
  await page.getByLabel('Адрес доставки', { exact: true }).fill('Алматы, Ауэзова 20');
  await page.getByRole('button', { name: 'Найти доставку на карте', exact: true }).click();
  await expect(page.getByText('Дом найден автоматически', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Выбрать этот адрес', exact: true }).click();
  await page.getByLabel('Имя получателя', { exact: true }).fill('Тест поиска адресов');
  await page.getByLabel('Телефон получателя', { exact: true }).fill('+77000000000');
  const marker = `E2E geocoding ${randomUUID().slice(0, 8)} — результаты поиска симулированы тестом`;
  await page.getByLabel('Комментарий курьеру', { exact: true }).fill(marker);
  await page.getByRole('button', { name: 'Проверить заказ', exact: true }).click();
  const response = page.waitForResponse((r) => r.url().endsWith('/api/orders') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Подтвердить заказ', exact: true }).click();
  const { order } = await (await response).json();
  expect(order.pickupPoint).toEqual({ latitude: house.latitude, longitude: house.longitude });
  expect(order.destinationPoint).toEqual({ latitude: 43.19883, longitude: 76.84452 });
  expect(queries).toEqual(['Алматы, Абая 10', 'Алматы, Ауэзова 20']);
  await page.reload();
  const persisted = (await (await page.request.get('/api/orders')).json()).orders.find((o: { id: string }) => o.id === order.id);
  expect(persisted.pickupPoint).toEqual(order.pickupPoint); expect(persisted.destinationPoint).toEqual(order.destinationPoint);
  // Leave a labelled cancelled test order rather than a new available delivery.
  expect((await page.request.post(`/api/orders/${order.id}/status`, { headers: { Origin: origin }, data: { status: 'CANCELLED' } })).ok()).toBe(true);
});

test('ambiguous and street-only matches require a choice; errors retain the address and manual map selection', async ({ page, context }) => {
  await mockMapTiles(context); await login(page);
  let mode = 'ambiguous';
  await page.route('**/api/geocoding', (route) => mode === 'error' ? route.fulfill({ status: 503, json: { error: 'Тест: сервис недоступен' } }) : route.fulfill({ json: { results: mode === 'empty' ? [] : [house, { ...house, id: 'ab-street', address: 'проспект Абая', precision: 'street', latitude: 43.24 }] } }));
  await page.getByLabel('Адрес отправления', { exact: true }).fill('Алматы, проспект Абая');
  await page.getByRole('button', { name: 'Найти отправление на карте', exact: true }).click();
  const results = page.getByRole('region', { name: 'Результаты поиска адреса' });
  await expect(results.getByRole('button')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Выбрать этот адрес', exact: true })).toBeDisabled();
  await results.getByRole('button').filter({ hasText: 'Только улица' }).click();
  await expect(page.getByText('Дом не определён', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выбрать этот адрес', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Выбрать точку в центре', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Выбрать этот адрес', exact: true })).toBeEnabled();
  await page.getByLabel('Адрес отправления', { exact: true }).fill('Алматы, неизвестная улица 999');
  mode = 'empty'; await page.getByRole('button', { name: 'Найти на карте', exact: true }).click();
  await expect(page.getByText('Адрес не найден', { exact: true })).toBeVisible();
  mode = 'error'; await page.getByRole('button', { name: 'Найти на карте', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Тест: сервис недоступен');
  await expect(page.getByLabel('Адрес отправления', { exact: true })).toHaveValue('Алматы, неизвестная улица 999');
  await page.getByRole('button', { name: 'Указать вручную на карте', exact: true }).click();
  await page.getByRole('button', { name: 'Выбрать точку в центре', exact: true }).click();
  await page.getByRole('button', { name: 'Выбрать этот адрес', exact: true }).click();
  await expect(page.getByLabel('Адрес отправления', { exact: true })).toHaveValue('Алматы, неизвестная улица 999');
});
