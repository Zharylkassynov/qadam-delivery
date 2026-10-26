import { expect, test } from '@playwright/test';
import { signedTelegramData } from '../telegram-fixture';
import { miniApp, fillCourierDetails } from './telegram-browser-fixture';

test.skip(Boolean(process.env.E2E_ORIGIN), 'Synthetic Telegram proof is restricted to the local test database');

test('signed courier link opens the form and SDK contact fills only the verified server phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const proof = signedTelegramData({ id: 3800000000000 + Math.floor(Math.random() * 1000000000), first_name: 'Анкета по ссылке' }, { start_param: 'courier_uni' });
  await miniApp(page, proof, 700, '', { contact: 'allow' });
  await expect(page.getByRole('heading', { name: 'Доставляй с Qadam', exact: true })).toBeVisible();
  await page.route('**/api/telegram-profile', async route => route.fulfill({ json: { phone: (await page.locator('html').getAttribute('data-contact-requested')) ? '+77010000000' : null, allowsWrite: false } }));
  await expect(page.getByRole('checkbox', { name: 'Мне есть 18 лет.', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /^Принимаю правила сервиса/ })).not.toBeChecked();
  await page.getByRole('button', { name: 'Поделиться номером', exact: true }).click();
  await expect(page.getByLabel('Телефон для связи', { exact: true })).toHaveValue('+77010000000');
  await page.getByRole('button', { name: 'Разрешить уведомления', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Уведомления выключены');
  await fillCourierDetails(page);
  await expect(page.getByRole('link', { name: 'правила сервиса', exact: true })).toHaveAttribute('href', '/rules');
  await expect(page.getByRole('link', { name: 'политике конфиденциальности', exact: true })).toHaveAttribute('href', '/privacy');
  const submit = page.waitForResponse(response => response.url().endsWith('/api/courier-application') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Отправить заявку', exact: true }).click();
  const response = await submit;
  expect(response.status()).toBe(201);
  const { application } = await response.json();
  expect(application.source).toBe('courier_uni'); expect(application.district).toBe('ALMALY'); expect(application.availability).toEqual(['EVENING']);
  expect(application.consentAt).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'Заявка отправлена', exact: true })).toBeVisible();
  expect(await page.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('courier-pending.png') });
});

test('URL courier link supports manual phone when contact sharing is declined', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const proof = signedTelegramData({ id: 3900000000000 + Math.floor(Math.random() * 1000000000), first_name: 'Ручной номер' });
  await miniApp(page, proof, 700, '', { query: 'screen=courier&src=courier_kaspi' });
  await expect(page.getByRole('heading', { name: 'Доставляй с Qadam', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('courier-form-top.png') });
  await page.getByRole('button', { name: 'Поделиться номером', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Номер не передан');
  await page.getByLabel('Телефон для связи', { exact: true }).fill('+7 702 000 00 00');
  await fillCourierDetails(page);
  await page.screenshot({ path: testInfo.outputPath('courier-form-bottom.png') });
  const submit = page.waitForResponse(response => response.url().endsWith('/api/courier-application') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Отправить заявку', exact: true }).click();
  const { application } = await (await submit).json(); expect(application.source).toBe('courier_kaspi');
  await expect(page.getByRole('heading', { name: 'Заявка отправлена', exact: true })).toBeVisible();
});

test('rules and privacy pages explain the actual operator, storage and deletion contact', async ({ page }) => {
  await page.route('https://telegram.org/js/telegram-web-app.js?64', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.goto('/rules'); await expect(page.getByRole('heading', { level: 1 })).toHaveText('Правила сервиса');
  await page.getByRole('link', { name: 'Политика конфиденциальности', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Политика конфиденциальности');
  await expect(page.getByRole('main')).toContainText('Команда Qadam');
  await expect(page.getByRole('main')).toContainText('Франкфурт');
  await expect(page.getByRole('main')).toContainText('фонового отслеживания нет');
  await expect(page.getByRole('link', { name: '@zharlkssnv', exact: true }).first()).toHaveAttribute('href', 'https://t.me/zharlkssnv');
});
