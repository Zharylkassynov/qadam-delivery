import {expect,type Page} from '@playwright/test';
import {courierLocationConsent} from '../../src/lib/location-consent';
export async function enableShiftGps(page:Page,waitForFix=true){
  if(waitForFix&&await page.evaluate(async()=>!window.Telegram?.WebApp?.initData&&(await navigator.permissions.query({name:'geolocation'})).state!=='granted')){
    await page.context().grantPermissions(['geolocation']);await page.context().setGeolocation({latitude:43.24,longitude:76.9,accuracy:22});
  }
  const start=page.getByRole('button',{name:/^(Включить смену|Выйти на линию)$/});
  const toggle=page.getByRole('switch',{name:'Я на линии'});
  await expect(page.locator('.courier-gps')).toBeVisible();
  await expect(page.getByText('Проверяем геопозицию…',{exact:true})).toHaveCount(0);
  if(waitForFix&&await page.getByText(/^Позиция сохранена:/).isVisible())return;
  if(await start.isVisible()){await start.click();await expect(start).toHaveCount(0);}
  else if(await toggle.evaluateAll(nodes=>nodes[0]?.getAttribute('aria-checked')==='false')){await toggle.click();}
  const consent=page.getByRole('checkbox',{name:courierLocationConsent});
  if(await consent.isVisible()){await consent.check();await page.getByRole('button',{name:'Разрешить геопозицию',exact:true}).click();}
  if(waitForFix){
    const saved=page.getByText(/^Позиция сохранена:/);
    const retry=page.getByRole('button',{name:'Повторить геолокацию',exact:true});
    // A saved consent starts GPS automatically. Let that finish before trying
    // recovery: the temporary retry button can disappear during a click.
    try{await expect(saved).toBeVisible({timeout:3000});}
    catch{
      if(await retry.isVisible()&&await retry.isEnabled()){
        try{await retry.click({timeout:3000});}
        catch(error){if(!await saved.isVisible())throw error;}
      }
      await expect(saved).toBeVisible();
    }
  }
}
