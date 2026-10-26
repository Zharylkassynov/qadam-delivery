import type { Page } from '@playwright/test';

// Test SDK and signed test-bot identities are used only against the local _test DB.
export async function miniApp(page: Page, proof: string, height = 700, origin = '') {
  await page.route('https://telegram.org/js/telegram-web-app.js?64', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.Telegram={WebApp:{initData:${JSON.stringify(proof)},ready(){},expand(){document.documentElement.style.setProperty('--tg-viewport-stable-height','${height}px')},isVersionAtLeast(){return true},LocationManager:{isInited:true,isLocationAvailable:true,isAccessGranted:true,isAccessRequested:true,init(cb){cb()},getLocation(cb){cb({latitude:43.24,longitude:76.9,horizontal_accuracy:22})},openSettings(){}}}};`,
  }));
  await page.route('**/api/**', async route => {
    const headers = await route.request().allHeaders(); delete headers.cookie;
    await route.continue({ headers });
  });
  await page.goto(`${origin}/#tgWebAppVersion=8.0`);
}
