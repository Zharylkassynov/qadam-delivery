import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signedTelegramData } from '../telegram-fixture';
import pg from 'pg';
import { mockMapTiles } from './map-fixture';

// Local test bot key and a mocked Telegram SDK; never forge production identities.
test.skip(Boolean(process.env.E2E_ORIGIN), 'Synthetic Telegram login runs only against the separate local test database');
const origin = 'http://127.0.0.1:3100';
async function miniApp(page: Page, proof: string) {
  await page.route('https://telegram.org/js/telegram-web-app.js?64', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.Telegram={WebApp:{initData:${JSON.stringify(proof)},ready(){},expand(){document.documentElement.style.setProperty('--tg-viewport-stable-height','700px')},isVersionAtLeast(){return true},LocationManager:{isInited:true,isLocationAvailable:true,isAccessGranted:true,isAccessRequested:true,init(cb){cb()},getLocation(cb){cb({latitude:43.24,longitude:76.9,horizontal_accuracy:22})},openSettings(){}}}};`,
  }));
  // Strip every cookie to reproduce Telegram Web with third-party cookies blocked.
  await page.route('**/api/**', async (route) => {
    const headers = await route.request().allHeaders();
    delete headers.cookie;
    await route.continue({ headers });
  });
  await page.goto('/#tgWebAppVersion=8.0');
}

test('Mini App customer completes a delivery with browser courier and restores history without cookies', async ({ browser }, testInfo) => {
  const customerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const courierContext = await browser.newContext();
  const customer = await customerContext.newPage();
  const courier = await courierContext.newPage();
  const proof = signedTelegramData({ id: 2000000000000 + Math.floor(Math.random() * 1000000000), first_name: 'Telegram автотест' });
  const pickup = `E2E Telegram ${randomUUID().slice(0, 8)}, Алматы, Абая, 10`;
  try {
    await miniApp(customer, proof);
    await expect(customer.getByRole('heading', { name: /Доставка\s*по Алматы/ })).toBeVisible();
    const nav = customer.getByRole('navigation', { name: 'Мобильная навигация' });
    expect(await nav.evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(700);
    await customer.getByRole('button', { name: 'Заказать доставку', exact: true }).click();
    expect(await customer.getByRole('button', { name: 'Проверить заказ', exact: true }).evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(700);
    await customer.getByLabel('Адрес отправления', { exact: true }).fill(pickup);
    await customer.getByLabel('Адрес доставки', { exact: true }).fill('Алматы, улица Ауэзова, 20');
    await customer.getByLabel('Имя получателя', { exact: true }).fill('Тестовый получатель');
    await customer.getByLabel('Телефон получателя', { exact: true }).fill('+7 700 123 45 67');
    await customer.getByRole('button', { name: 'Проверить заказ', exact: true }).click();
    await customer.getByRole('button', { name: 'Подтвердить заказ', exact: true }).click();
    const detail = customer.getByRole('region', { name: 'Детали заказа' });
    await expect(detail.locator('.status-badge')).toHaveText('Ищем курьера');
    await courier.goto('/');
    await courier.getByLabel('Логин', { exact: true }).fill('courier1@qadam.demo');
    await courier.getByLabel('Пароль', { exact: true }).fill(process.env.DEMO_PASSWORD!);
    await courier.getByRole('button', { name: 'Войти в аккаунт', exact: true }).click();
    const card = courier.getByRole('button', { name: /^Открыть заказ/ }).filter({ hasText: pickup });
    await expect(card).toBeVisible();
    const orderButton = (await card.getAttribute('aria-label'))!;
    await card.click();
    await courier.getByRole('button', { name: 'Принять заказ', exact: true }).click();
    for (const action of ['Посылка у меня', 'Начать доставку', 'Завершить доставку']) await courier.getByRole('button', { name: action, exact: true }).click();
    await expect(detail.getByRole('heading', { name: 'Посылка у получателя', exact: true })).toBeVisible();
    expect((await customerContext.cookies()).filter((cookie) => cookie.name === 'qadam_session')).toHaveLength(0);
    expect(await customer.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((key) => /qadam|token/i.test(key)))).toHaveLength(0);
    await customer.close();
    const reopened = await customerContext.newPage();
    await miniApp(reopened, proof);
    const navigation = reopened.getByRole('navigation', { name: 'Мобильная навигация' });
    await navigation.getByRole('button', { name: 'Заказы', exact: true }).click();
    await reopened.getByRole('button', { name: 'Завершённые', exact: true }).click();
    await reopened.getByRole('button', { name: orderButton, exact: true }).click();
    await expect(reopened.locator('.timeline li')).toHaveCount(6);
    await reopened.screenshot({ path: testInfo.outputPath('telegram-mobile-history.png'), fullPage: true });
    await reopened.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(reopened.getByRole('button', { name: 'Войти через Telegram', exact: true })).toBeVisible();
    expect((await reopened.request.get('/api/orders')).status()).toBe(401);
    await reopened.getByRole('button', { name: 'Войти через Telegram', exact: true }).click();
    await navigation.getByRole('button', { name: 'Профиль', exact: true }).click();
    await expect(reopened.locator('.profile-card')).toContainText('Telegram ID:');
  } finally { await customerContext.close(); await courierContext.close(); }
});

test('Mini App rejects forged proof and a client role, and permits only Telegram Web framing', async ({ page, request }) => {
  const proof = signedTelegramData({ id: 12345678, first_name: 'Тест' });
  const forged = new URLSearchParams(proof);
  forged.set('user', JSON.stringify({ id: 999, first_name: 'Подмена' }));
  await miniApp(page, forged.toString());
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Не удалось подтвердить вход из Telegram');
  await expect(page.getByLabel('Логин', { exact: true })).toHaveCount(0);
  expect((await request.post('/api/auth/telegram', { headers: { Origin: origin }, data: { initData: proof, role: 'COURIER' } })).status()).toBe(400);
  expect((await request.post('/api/auth/telegram', { headers: { Origin: 'https://evil.invalid' }, data: { initData: proof } })).status()).toBe(403);
  const headers = (await request.get('/')).headers();
  expect(headers['content-security-policy']).toBe("frame-ancestors 'self' https://web.telegram.org");
  expect(headers['x-frame-options']).toBeUndefined();
});

test('Telegram applicant is rejected, reapplies, gets admin approval and completes a courier delivery', async ({ browser, request }, testInfo) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8), applicantName = `Курьер E2E ${suffix}`;
  const proof = signedTelegramData({ id: 3300000000000 + Math.floor(Math.random() * 1000000000), first_name: applicantName });
  const adminProof = signedTelegramData({ id: 3400000000000 + Math.floor(Math.random() * 1000000000), first_name: `Админ E2E ${suffix}` });
  const bootstrap = await request.post('/api/auth/telegram', { headers: { Origin: origin }, data: { initData: adminProof } });
  expect(bootstrap.status()).toBe(200);
  const { user: adminUser } = await bootstrap.json();
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Admin bootstrap is allowed only in the separate local test database');
  const db = new pg.Client({ connectionString: url }); await db.connect();
  try { await db.query('INSERT INTO qadam.administrators(user_id) VALUES($1)', [adminUser.id]); } finally { await db.end(); }
  const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const applicantContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await mockMapTiles(applicantContext);
  const admin = await adminContext.newPage(), applicant = await applicantContext.newPage();
  try {
    await miniApp(admin, adminProof); await miniApp(applicant, proof);
    const mobileProfile = (page: Page) => page.getByRole('navigation', { name: 'Мобильная навигация' }).getByRole('button', { name: 'Профиль', exact: true });
    await mobileProfile(admin).click(); await admin.getByRole('button', { name: 'Заявки курьеров', exact: true }).click();
    await mobileProfile(applicant).click(); await expect(applicant.getByRole('button', { name: 'Заявки курьеров', exact: true })).toHaveCount(0);
    await applicant.getByRole('button', { name: 'Стать курьером', exact: true }).click();
    await applicant.getByLabel('Телефон для связи').fill('+++++++');
    await applicant.getByRole('button', { name: 'Отправить заявку', exact: true }).click();
    await expect(applicant.getByRole('main').getByRole('alert')).toContainText('Проверьте телефон');
    await expect(applicant.getByLabel('Телефон для связи')).toHaveValue('+++++++');
    await applicant.getByLabel('Телефон для связи').fill('+7 700 000 00 00');
    await applicant.getByLabel('Способ доставки').selectOption('BICYCLE');
    await applicant.getByLabel('Комментарий', { exact: true }).fill('Автотест заявки, не реальный курьер');
    expect(await applicant.getByRole('button', { name: 'Отправить заявку', exact: true }).evaluate((n) => n.getBoundingClientRect().bottom)).toBeLessThanOrEqual(700);
    await applicant.screenshot({ path: testInfo.outputPath('courier-application-form.png'), fullPage: true });
    await applicant.getByRole('button', { name: 'Отправить заявку', exact: true }).click();
    await expect(applicant.getByRole('heading', { name: 'Заявка отправлена', exact: true })).toBeVisible();
    const candidate = admin.locator('.application-card').filter({ hasText: applicantName });
    await candidate.getByRole('button', { name: 'Рассмотреть заявку', exact: true }).click();
    await admin.getByRole('button', { name: 'Отклонить заявку', exact: true }).click();
    await expect(admin.getByRole('main').getByRole('alert')).toContainText('минимум 5 символов');
    await admin.getByLabel('Причина отклонения', { exact: true }).fill('Уточните контактный телефон');
    await expect(admin.getByRole('main').getByRole('alert')).toHaveCount(0);
    await admin.screenshot({ path: testInfo.outputPath('admin-application-review.png'), fullPage: true });
    await admin.getByRole('button', { name: 'Отклонить заявку', exact: true }).click();
    await expect(applicant.getByText('Причина: Уточните контактный телефон', { exact: true })).toBeVisible();
    await applicant.close();
    const reopened = await applicantContext.newPage(); await miniApp(reopened, proof);
    await mobileProfile(reopened).click(); await reopened.getByRole('button', { name: 'Стать курьером', exact: true }).click();
    await expect(reopened.getByText('Причина: Уточните контактный телефон', { exact: true })).toBeVisible();
    await reopened.getByRole('button', { name: 'Подать повторно', exact: true }).click();
    await expect(reopened.getByLabel('Телефон для связи')).toHaveValue('+7 700 000 00 00');
    await reopened.getByLabel('Телефон для связи').fill('+7 701 000 00 00');
    await reopened.getByRole('button', { name: 'Отправить заявку', exact: true }).click();
    await admin.getByRole('button', { name: 'К списку заявок', exact: true }).click();
    await candidate.getByRole('button', { name: 'Рассмотреть заявку', exact: true }).click();
    await admin.getByRole('button', { name: 'Одобрить заявку', exact: true }).click();
    await expect(reopened.getByRole('heading', { name: 'Можно начинать', exact: true })).toBeVisible();
    await reopened.screenshot({ path: testInfo.outputPath('courier-application-approved.png'), fullPage: true });
    await reopened.getByRole('button', { name: 'К доступным заказам', exact: true }).click();
    await expect(reopened.getByRole('heading', { name: 'Можно принять', exact: true })).toBeVisible();
    const pickup = `E2E approved ${suffix}, Алматы, Абая 14`;
    expect((await request.post('/api/auth/login', { headers: { Origin: origin }, data: { email: 'customer1@qadam.demo', password: process.env.DEMO_PASSWORD } })).status()).toBe(200);
    const orderResponse = await request.post('/api/orders', { headers: { Origin: origin }, data: { requestKey: randomUUID(), pickupAddress: pickup, destinationAddress: 'Алматы, Ауэзова 20', recipientName: 'Тестовый получатель', recipientPhone: '+7 700 000 00 00', notes: 'E2E проверка одобренного курьера' } });
    expect(orderResponse.status()).toBe(201); const { order } = await orderResponse.json();
    const card = reopened.getByRole('button', { name: /^Открыть заказ/ }).filter({ hasText: pickup });
    await card.click();
    await reopened.getByRole('button', { name: 'Принять заказ', exact: true }).click();
    await reopened.getByRole('button', { name: 'Передавать геопозицию', exact: true }).click();
    await expect(reopened.getByText(/^Позиция сохранена:/)).toBeVisible();
    for (const action of ['Посылка у меня', 'Начать доставку', 'Завершить доставку']) await reopened.getByRole('button', { name: action, exact: true }).click();
    await expect(reopened.getByRole('heading', { name: 'Доставка завершена', exact: true })).toBeVisible();
    const { orders } = await (await request.get('/api/orders')).json();
    expect(orders.find((item: { id: string }) => item.id === order.id).status).toBe('DELIVERED');
    // Native LocationManager is simulated here; no browser GPS or real Telegram identity.
    expect(orders.find((item: { id: string }) => item.id === order.id).courierLocation.latitude).toBe(43.24);
    await admin.getByRole('button', { name: 'Назад в профиль' }).click();
    await expect(admin.getByRole('heading', { name: /Доставка\s*по Алматы/ })).toHaveCount(0);
    // Administrator remains a customer, with their own ordinary order access.
    await admin.getByRole('button', { name: 'Назад в профиль' }).click();
    await expect(admin.locator('.profile-card')).toContainText('Клиент');
  } finally { await adminContext.close(); await applicantContext.close(); }
});
