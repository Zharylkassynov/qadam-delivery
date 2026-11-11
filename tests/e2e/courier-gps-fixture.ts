import {expect,type Page} from '@playwright/test';
import {courierLocationConsent} from '../../src/lib/location-consent';
export async function enableShiftGps(page:Page,waitForFix=true){
  if(waitForFix&&await page.evaluate(async()=>!window.Telegram?.WebApp?.initData&&(await navigator.permissions.query({name:'geolocation'})).state!=='granted')){
    await page.context().grantPermissions(['geolocation']);await page.context().setGeolocation({latitude:43.24,longitude:76.9,accuracy:22});
  }
  const start=page.getByRole('button',{name:/^(Включить смену|Выйти на линию)$/});
  const toggle=page.getByRole('switch',{name:'Я на линии'});
  const saved=page.getByText(/^Позиция сохранена:/),ready=page.getByRole('status',{name:'Можно принимать заказы',exact:true});
  const accept=page.getByRole('button',{name:/^Принять( заказ| за )/,includeHidden:true});
  const hasFix=async()=>await saved.isVisible()||await ready.isVisible()||(await accept.count()===1&&await accept.isEnabled());
  await expect.poll(async()=>await hasFix()||(await toggle.count()===1&&await toggle.isEnabled())||await start.isVisible()||await page.locator('.courier-gps').isVisible()).toBe(true);
  await expect(page.getByText('Проверяем геопозицию…',{exact:true})).toHaveCount(0);
  if(waitForFix&&await hasFix())return;
  if(await start.isVisible()){await start.click();await expect(start).toHaveCount(0);}
  else if(await toggle.evaluateAll(nodes=>nodes[0]?.getAttribute('aria-checked')==='false')){await toggle.click();}
  const consent=page.getByRole('checkbox',{name:courierLocationConsent});
  if(await consent.isVisible()){await consent.check();await page.getByRole('button',{name:'Разрешить геопозицию',exact:true}).click();}
  if(waitForFix){
    const retry=page.getByRole('button',{name:'Повторить геолокацию',exact:true});
    // A saved consent starts GPS automatically. Let that finish before trying
    // recovery: the temporary retry button can disappear during a click.
    try{await expect.poll(hasFix,{timeout:3000}).toBe(true);}
    catch{
      if(await retry.isVisible()&&await retry.isEnabled()){
        try{await retry.click({timeout:3000});}
        catch(error){if(!await hasFix())throw error;}
      }
      await expect.poll(hasFix).toBe(true);
    }
  }
}
