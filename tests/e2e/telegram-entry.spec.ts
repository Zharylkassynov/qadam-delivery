import { expect, test } from '@playwright/test';
import { signedTelegramData } from '../telegram-fixture';
import { miniApp } from './telegram-browser-fixture';

test.skip(Boolean(process.env.E2E_ORIGIN), 'Uses only the separate local server with demo login disabled');
const origin = 'http://127.0.0.1:3101';

for (const [width, height] of [[360, 780], [390, 844], [1440, 900]]) {
  test(`browser with demo login disabled opens Telegram at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.route('https://telegram.org/js/telegram-web-app.js?64', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.goto(origin);
    await expect(page.getByRole('heading', { name: 'Откройте Qadam в Telegram' })).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Войти в аккаунт' })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/демонстрац|учебн|тестов/i);
    const link = page.getByRole('link', { name: 'Открыть в Telegram' });
    await expect(link).toHaveAttribute('href', 'https://t.me/qadam_delivery_bot');
    await link.focus(); await expect(link).toBeFocused(); await expect(link).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('h1').evaluate(el => getComputedStyle(el).fontFamily)).toMatch(/onest/i);
    await page.screenshot({ path: testInfo.outputPath(`telegram-entry-${width}.png`), fullPage: true });
    expect((await (await page.request.get(`${origin}/api/session`)).json()).demo).toBe(false);
    expect((await page.request.post(`${origin}/api/auth/login`, { headers: { Origin: origin }, data: { email: 'customer1@qadam.demo', password: 'disabled-login' } })).status()).toBe(403);
  });
}

test('Telegram still signs in automatically when demo login is disabled', async ({ page }) => {
  const proof = signedTelegramData({ id: 3600000000000 + Math.floor(Math.random() * 1000000000), first_name: 'Айгерим' });
  await miniApp(page, proof, 700, origin);
  await expect(page.getByRole('heading', { name: /^(Куда доставить\?|Текущая доставка)$/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Открыть в Telegram' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Выйти/ })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/демонстрац|учебн|тестов/i);
});
