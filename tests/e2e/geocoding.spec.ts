import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mockMapTiles } from './map-fixture';

const origin = process.env.E2E_ORIGIN ?? 'http://127.0.0.1:3100';
const house = { id: 'ab-market-10', address: 'проспект Абая, 10', detail: 'Алматы', precision: 'building', latitude: 43.24189, longitude: 76.94684 };
const destination = { ...house, id: 'auezov-20', address: 'улица Ауэзова, 20', latitude: 43.19883, longitude: 76.84452 };
const pageErrors = new WeakMap<Page, string[]>();
test.use({ viewport: { width: 390, height: 844 } });
test.beforeEach(({ page }) => { const errors: string[] = []; pageErrors.set(page, errors); page.on('pageerror', (error) => errors.push(error.stack ?? error.message)); });
test.afterEach(({ page }) => { expect(pageErrors.get(page)).toEqual([]); });
async function login(page: Page) {
  await page.goto('/'); await page.getByLabel('Логин', { exact: true }).fill('customer2@qadam.demo');
  await page.getByLabel('Пароль', { exact: true }).fill(process.env.DEMO_PASSWORD!);
  const ordersLoaded = page.waitForResponse((response) => response.url().endsWith('/api/orders') && response.request().method() === 'GET');
  await page.getByRole('button', { name: 'Войти в аккаунт', exact: true }).click();
  await ordersLoaded;
  await expect(page.getByRole('navigation', { name: 'Мобильная навигация' })).toBeVisible();
  await expect(page.getByText('Загружаем доставки…', { exact: true })).not.toBeVisible();
  const start = page.getByRole('button', { name: 'Указать адреса', exact: true });
  if (!await start.isVisible()) await page.getByRole('button', { name: 'Новая доставка', exact: true }).click();
  await start.click();
}

async function findAddress(page: Page, kind: 'pickup' | 'destination', value: string) {
  await page.getByLabel(kind === 'pickup' ? 'Адрес отправления' : 'Адрес доставки', { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Найти адрес', exact: true }).click();
}

async function openDetails(page: Page) {
  await page.getByRole('button', { name: 'Далее — получатель', exact: true }).click();
  await expect(page.getByLabel('Имя получателя', { exact: true })).toBeVisible();
}

async function confirmDelivery(page: Page) {
  const response = page.waitForResponse((r) => r.url().endsWith('/api/orders') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Подтвердить заказ', exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(201);
  return (await result.json()).order;
}

async function cancelTestOrder(page: Page, id: string | undefined) {
  if (id) expect((await page.request.post(`/api/orders/${id}/status`, { headers: { Origin: origin }, data: { status: 'CANCELLED' } })).ok()).toBe(true);
}

test('exact house stays in search, optional map refinement saves both pins and reopening restores them', async ({ page, context }, info) => {
  await mockMapTiles(context);
  await page.route('**/api/map-config', (route) => route.fulfill({ json: { provider: 'geoapify', tileUrl: '/api/map-tiles/{z}/{x}/{y}', maxZoom: 19 } }));
  const queries: string[] = [];
  await page.route('**/api/geocoding', (route) => { const query = route.request().postDataJSON().query; queries.push(query); return route.fulfill({ json: { results: [query.includes('Ауэзова') ? destination : house] } }); });
  let createdId: string | undefined;
  try {
    await login(page);
    await expect(page.getByRole('button', { name: 'Выбрать адрес', exact: true })).toBeDisabled();
    await findAddress(page, 'pickup', 'Алматы, Абая 10');
    await expect(page.getByRole('heading', { name: 'Найденный адрес', exact: true })).toBeVisible();
    await expect(page.getByLabel('Адрес отправления', { exact: true })).toHaveValue('проспект Абая, 10, Алматы');
    await expect(page.locator('.address-picker-map')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Выбрать адрес', exact: true })).toBeEnabled();
    await page.screenshot({ path: info.outputPath('exact-address-search-mobile.png') });

    await page.getByRole('button', { name: 'Уточнить на карте', exact: true }).click();
    await expect(page.locator('.qadam-map-marker.pickup')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Geoapify', exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Подтвердить точку', exact: true }).click();
    await expect(page.getByLabel('Адрес доставки', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Выбранный адрес отправления' })).toContainText(house.address);
    await findAddress(page, 'destination', 'Алматы, Ауэзова 20');
    await expect(page.getByRole('heading', { name: 'Найденный адрес', exact: true })).toBeVisible();
    await expect(page.locator('.address-picker-map')).toHaveCount(0);
    await page.getByRole('button', { name: 'Выбрать адрес', exact: true }).click();
    await openDetails(page);
    await page.getByLabel('Имя получателя', { exact: true }).fill('Тест поиска адресов');
    await page.getByLabel('Телефон получателя', { exact: true }).fill('+77000000000');
    await page.getByLabel('Комментарий курьеру', { exact: true }).fill(`E2E geocoding ${randomUUID().slice(0, 8)} — результаты поиска симулированы тестом`);
    await page.getByRole('button', { name: 'Проверить заказ', exact: true }).click();
    const order = await confirmDelivery(page); createdId = order.id;
    expect(order.pickupPoint).toEqual({ latitude: house.latitude, longitude: house.longitude });
    expect(order.destinationPoint).toEqual({ latitude: destination.latitude, longitude: destination.longitude });
    expect(queries).toEqual(['Алматы, Абая 10', 'Алматы, Ауэзова 20']);
    await page.reload();
    const persisted = (await (await page.request.get('/api/orders')).json()).orders.find((o: { id: string }) => o.id === order.id);
    expect(persisted.pickupPoint).toEqual(order.pickupPoint); expect(persisted.destinationPoint).toEqual(order.destinationPoint);
  } finally { await cancelTestOrder(page, createdId); }
});

test('coarse matches require a manual pin; empty and failed search preserve text and never reuse the old pin', async ({ page, context }, info) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockMapTiles(context);
  let mode = 'ambiguous';
  await page.route('**/api/geocoding', (route) => mode === 'error' ? route.fulfill({ status: 503, json: { error: 'Тест: сервис недоступен' } }) : route.fulfill({ json: { results: mode === 'empty' ? [] : [house, { ...house, id: 'ab-street', address: 'проспект Абая', precision: 'street', latitude: 43.24 }] } }));
  await login(page);
  await findAddress(page, 'pickup', 'Алматы, проспект Абая');
  const results = page.getByRole('region', { name: 'Результаты поиска адреса' });
  await expect(results.getByRole('button')).toHaveCount(2);
  // A written address is allowed; choosing a coarse result must not create a false exact pin.
  await expect(page.getByRole('button', { name: 'Выбрать адрес', exact: true })).toBeEnabled();
  await results.getByRole('button').filter({ hasText: 'Только улица' }).click();
  await expect(page.getByText('Дом не определён', { exact: true })).toBeVisible();
  await expect(page.locator('.qadam-map-marker.pickup')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Подтвердить точку', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Выбрать точку в центре', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Подтвердить точку', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Вернуться к поиску', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Уточнить на карте', exact: true })).toBeVisible();
  await page.getByLabel('Адрес отправления', { exact: true }).fill('Алматы, неизвестная улица 999');
  mode = 'empty'; await page.getByRole('button', { name: 'Найти адрес', exact: true }).click();
  await expect(page.getByText('Адрес не найден', { exact: true })).toBeVisible();
  mode = 'error'; await page.getByRole('button', { name: 'Найти адрес', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Тест: сервис недоступен');
  await expect(page.getByLabel('Адрес отправления', { exact: true })).toHaveValue('Алматы, неизвестная улица 999');
  await expect(page.getByRole('button', { name: 'Выбрать адрес', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Указать вручную на карте', exact: true }).click();
  await expect(page.locator('.qadam-map-marker.pickup')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Подтвердить точку', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Выбрать точку в центре', exact: true }).click();
  await page.screenshot({ path: info.outputPath('manual-point-after-search-error-mobile.png') });
  await page.getByRole('button', { name: 'Вернуться к поиску', exact: true }).click();
  await expect(page.getByLabel('Адрес отправления', { exact: true })).toHaveValue('Алматы, неизвестная улица 999');
  await page.getByRole('button', { name: 'Выбрать адрес', exact: true }).click();
  await expect(page.getByLabel('Адрес доставки', { exact: true })).toBeVisible();
});

test('editing a selected address clears its old coordinates and preserves recipient draft across back and review', async ({ page, context }) => {
  await mockMapTiles(context);
  const queries: string[] = [];
  await page.route('**/api/geocoding', (route) => { const query = route.request().postDataJSON().query; queries.push(query); return route.fulfill({ json: { results: [query.includes('Ауэзова') ? destination : house] } }); });
  let createdId: string | undefined;
  try {
    await login(page);
    await findAddress(page, 'pickup', 'Алматы, Абая 10');
    await expect(page.getByRole('heading', { name: 'Найденный адрес', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Выбрать адрес', exact: true }).click();
    await findAddress(page, 'destination', 'Алматы, Ауэзова 20');
    await expect(page.getByRole('heading', { name: 'Найденный адрес', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Выбрать адрес', exact: true }).click();
    await openDetails(page);
    const notes = `E2E address draft ${randomUUID().slice(0, 8)} — координаты из поиска симулированы`;
    await page.getByLabel('Имя получателя', { exact: true }).fill('Получатель черновика');
    await page.getByLabel('Телефон получателя', { exact: true }).fill('+77000000000');
    await page.getByLabel('Комментарий курьеру', { exact: true }).fill(notes);
    await page.getByRole('button', { name: 'Изменить адрес отправления', exact: true }).click();
    const editedAddress = 'Алматы, проспект Абая, 12';
    await page.getByLabel('Адрес отправления', { exact: true }).fill(editedAddress);
    await expect(page.getByRole('button', { name: 'Указать вручную на карте', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Выбрать адрес', exact: true }).click();
    await expect(page.getByLabel('Имя получателя', { exact: true })).toHaveValue('Получатель черновика');
    await expect(page.getByLabel('Телефон получателя', { exact: true })).toHaveValue('+77000000000');
    await expect(page.getByLabel('Комментарий курьеру', { exact: true })).toHaveValue(notes);
    await expect(page.getByRole('button', { name: 'Изменить адрес доставки', exact: true })).toContainText(destination.address);
    await page.getByRole('button', { name: 'Проверить заказ', exact: true }).click();
    await page.getByRole('button', { name: 'Изменить данные', exact: true }).click();
    await expect(page.getByLabel('Имя получателя', { exact: true })).toHaveValue('Получатель черновика');
    await expect(page.getByLabel('Комментарий курьеру', { exact: true })).toHaveValue(notes);
    await page.getByRole('button', { name: 'Проверить заказ', exact: true }).click();
    const order = await confirmDelivery(page); createdId = order.id;
    expect(order.pickupAddress).toBe(editedAddress);
    expect(order.pickupPoint).toBeNull();
    expect(order.destinationPoint).toEqual({ latitude: destination.latitude, longitude: destination.longitude });
    expect(queries).toEqual(['Алматы, Абая 10', 'Алматы, Ауэзова 20']);
  } finally { await cancelTestOrder(page, createdId); }
});
