import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signedTelegramData } from '../telegram-fixture';

// Local test bot key and a mocked Telegram SDK; never forge production identities.
test.skip(Boolean(process.env.E2E_ORIGIN), 'Synthetic Telegram login runs only against the separate local test database');
const origin = 'http://127.0.0.1:3100';
async function miniApp(page: Page, proof: string) {
  await page.route('https://telegram.org/js/telegram-web-app.js?64', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.Telegram={WebApp:{initData:${JSON.stringify(proof)},ready(){},expand(){document.documentElement.style.setProperty('--tg-viewport-stable-height','700px')}}};`,
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
    expect(await customer.locator('.app-shell').evaluate((el) => el.getBoundingClientRect().height)).toBe(700);
    await customer.getByRole('button', { name: 'Заказать доставку', exact: true }).click();
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
