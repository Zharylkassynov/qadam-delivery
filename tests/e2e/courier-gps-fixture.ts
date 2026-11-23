import {expect,type Page} from '@playwright/test';
import {courierLocationConsent} from '../../src/lib/location-consent';

export async function enableShiftGps(page:Page,waitForFix=true){
  const toggle=page.getByRole('switch',{name:'Я на линии'});
  const work=page.getByText('Настройки работы',{exact:true});
  const settings=page.getByRole('button',{name:'Настройки геолокации',exact:true});
  const preview=page.locator('.courier-offer-preview');
  const saved=page.locator('.courier-gps').getByText(/^Позиция сохранена:/);
  await expect.poll(async()=>await preview.isVisible()||await settings.isVisible()||(await toggle.count()===1&&await toggle.isEnabled())).toBe(true);
  if(await toggle.isVisible()&&await toggle.getAttribute('aria-checked')==='false'){
    await toggle.click();
  }
  // The offer only needs the shift. GPS can be enabled from home or a delivery.
  if(await preview.isVisible())return;
  if(waitForFix&&await saved.isVisible())return;
  if(waitForFix&&await page.evaluate(async()=>!window.Telegram?.WebApp?.initData&&(await navigator.permissions.query({name:'geolocation'})).state!=='granted')){
    await page.context().grantPermissions(['geolocation']);
    await page.context().setGeolocation({latitude:43.24,longitude:76.9,accuracy:22});
  }
  const wasWorkOpen=await work.evaluateAll(nodes=>nodes[0]?.closest('details')?.open===true);
  if(await work.isVisible()&&!wasWorkOpen)await work.click();
  if(await settings.isVisible())await settings.click();
  const consent=page.getByRole('checkbox',{name:courierLocationConsent});
  if(await consent.isVisible()){
    await consent.check();await page.getByRole('button',{name:'Разрешить геопозицию',exact:true}).click();
  }else if(!waitForFix){
    const refresh=page.getByRole('button',{name:'Обновить позицию',exact:true});
    if(await refresh.isVisible())await refresh.click();
  }
  if(waitForFix){
    await expect(saved).toBeVisible();
    await page.getByRole('button',{name:'Закрыть настройки',exact:true}).click();
    if(await work.isVisible()&&!wasWorkOpen)await work.click();
  }
}
