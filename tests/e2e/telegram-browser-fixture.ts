import type { BrowserContext,Page } from '@playwright/test';
import {installNativeFixture,type NativeFixtureOptions} from './telegram-native-fixture';

// Browser-only flows have no Telegram client and must not depend on its CDN.
// Mini App scenarios use their own signed SDK through miniApp below.
export async function mockBrowserTelegram(context:BrowserContext){
  await context.route('https://telegram.org/js/telegram-web-app.js?64',route=>route.fulfill({contentType:'application/javascript',body:'/* No Telegram client in a regular browser. */'}));
}

// Test SDK and signed test-bot identities are used only against the local _test DB.
export async function miniApp(page: Page, proof: string, height = 700, origin = '', options: { query?: string; contact?: 'allow' | 'deny'; location?:'allow'|'deny';native?:NativeFixtureOptions } = {}) {
  await page.route('https://telegram.org/js/telegram-web-app.js?64', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.Telegram={WebApp:{initData:${JSON.stringify(proof)},ready(){},expand(){document.documentElement.style.setProperty('--tg-viewport-stable-height','${height}px')},isVersionAtLeast(){return true},requestContact(cb){document.documentElement.dataset.contactRequested='true';cb(${options.contact === 'allow'})},requestWriteAccess(cb){cb(false)},LocationManager:{isInited:true,isLocationAvailable:true,isAccessGranted:${options.location !== 'deny'},isAccessRequested:true,init(cb){cb()},getLocation(cb){document.documentElement.dataset.locationRequests=String(Number(document.documentElement.dataset.locationRequests||0)+1);cb(${options.location === 'deny'?'null':"{latitude:Number(document.documentElement.dataset.gpsLatitude||43.24),longitude:Number(document.documentElement.dataset.gpsLongitude||76.9),horizontal_accuracy:22}"})},openSettings(){document.documentElement.dataset.locationSettings='opened'}}}};` + (options.native ? `;(${installNativeFixture.toString()})(window.Telegram.WebApp,${JSON.stringify(options.native)});` : ''),
  }));
  await page.route('**/api/**', async route => {
    const headers = await route.request().allHeaders(); delete headers.cookie;
    await route.continue({ headers });
  });
  await page.goto(`${origin}/${options.query ? `?${options.query}` : ''}#tgWebAppVersion=8.0`);
}

export async function fillCourierDetails(page: Page) {
  await page.getByLabel('Удобный район', { exact: true }).selectOption('ALMALY');
  await page.getByRole('checkbox', { name: 'Вечером', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Мне есть 18 лет.', exact: true }).check();
  await page.getByRole('checkbox', { name: /^Принимаю правила сервиса/ }).check();
}
