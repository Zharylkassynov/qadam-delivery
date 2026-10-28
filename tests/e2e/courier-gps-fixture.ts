import {expect,type Page} from '@playwright/test';
export async function enableShiftGps(page:Page,waitForFix=true){
  const start=page.getByRole('button',{name:'Включить смену',exact:true});
  const toggle=page.getByRole('switch',{name:'Я на линии'});
  await expect(page.locator('.courier-gps')).toBeVisible();
  if(await start.isVisible()){await start.click();await expect(start).toHaveCount(0);}
  else if(await toggle.isVisible()&&await toggle.getAttribute('aria-checked')==='false'){await toggle.click();await expect(toggle).toHaveAttribute('aria-checked','true');}
  const consent=page.getByRole('checkbox',{name:'Разрешаю показывать мою позицию во время смены.'});
  if(await consent.isVisible()){await consent.check();await page.getByRole('button',{name:'Разрешить геолокацию',exact:true}).click();}
  if(waitForFix)await expect(page.getByText(/^Позиция сохранена:/)).toBeVisible();
}
