import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {miniApp} from './telegram-browser-fixture';
import {signedTelegramData} from '../telegram-fixture';
import {mockMapTiles} from './map-fixture';

const origin='http://127.0.0.1:3100';
test.skip(Boolean(process.env.E2E_ORIGIN),'Local synthetic recipient only');
test.use({viewport:{width:390,height:844}});

test('recipient link errors fit mobile themes, retry recovers and customer controls stay separate',async({page,request,context},info)=>{
  await mockMapTiles(context);
  const proof=signedTelegramData({id:8900000000000+Math.floor(Math.random()*1e9),first_name:'Отправитель восстановления'});
  const login=await request.post('/api/auth/telegram',{headers:{Origin:origin},data:{initData:proof}});expect(login.status()).toBe(200);
  const account=await login.json(),headers={Origin:origin,Authorization:`Bearer ${account.sessionToken}`};
  const created=await request.post('/api/orders',{headers,data:{requestKey:randomUUID(),pickupAddress:'Алматы, Абая 10',destinationAddress:'Алматы, Сатпаева 30',recipientName:'Получатель восстановления',recipientPhone:'+77000000000',notes:'',pickupPoint:{latitude:43.24,longitude:76.9},destinationPoint:{latitude:43.25,longitude:76.91}}});
  expect(created.status()).toBe(201);const order=(await created.json()).order;
  const courierRequests:string[]=[];
  page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/courier/'))courierRequests.push(r.url());});
  try{
    await miniApp(page,proof,760,'',{query:`order=${order.id}`,native:{}});
    const sharing=page.locator('.recipient-share');await expect(sharing).toBeVisible();
    let unavailable=true;
    await page.route(`**/api/orders/${order.id}/recipient-link`,route=>unavailable&&route.request().method()==='GET'?route.fulfill({status:503,json:{error:'Сервис временно недоступен'}}):route.continue());
    await page.reload();const alert=sharing.getByRole('alert');await expect(alert).toContainText('Не удалось проверить ссылку.');
    for(const dark of [false,true]){
      await page.evaluate(dark=>window.__qadamTelegram!.changeTheme(dark,dark?{bg_color:'#1c1c1c',secondary_bg_color:'#000000',text_color:'#ffffff',hint_color:'#aaaaaa',button_color:'#000000',button_text_color:'#ffffff'}:{}),dark);
      await expect(page.locator('html')).toHaveAttribute('data-color-scheme',dark?'dark':'light');
      for(const width of [320,390,768]){
        await page.setViewportSize({width,height:844});await alert.scrollIntoViewIfNeeded();
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        const box=(await alert.boundingBox())!,text=(await alert.locator('.feedback-title').boundingBox())!,retry=(await alert.getByRole('button',{name:'Повторить',exact:true}).boundingBox())!;
        expect(text.width).toBeGreaterThan(box.width*.7);expect(text.height).toBeLessThanOrEqual(60);
        expect(retry.y).toBeGreaterThanOrEqual(text.y+text.height);expect(retry.x+retry.width).toBeLessThanOrEqual(box.x+box.width);
        if(width===390)await page.screenshot({path:info.outputPath(`recipient-link-error-${dark?'dark':'light'}.png`)});
      }
    }
    unavailable=false;await alert.getByRole('button',{name:'Повторить',exact:true}).click();
    await expect(sharing.getByRole('alert')).toHaveCount(0);await sharing.getByRole('button',{name:'Создать ссылку',exact:true}).click();
    await expect(sharing.getByRole('link',{name:'Отправить в WhatsApp',exact:true})).toBeVisible();
    await expect(sharing.getByRole('textbox',{name:'Ссылка для получателя',exact:true})).toHaveCount(0);
    await sharing.getByText('Настройки ссылки',{exact:true}).click();
    await expect(sharing.getByRole('textbox',{name:'Ссылка для получателя',exact:true})).toHaveValue(/\/t\/[\w-]{43}$/);
    await sharing.getByRole('button',{name:'Отключить ссылку',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>window.__qadamTelegram!.confirmations.length)).toBe(1);
    await page.evaluate(()=>window.__qadamTelegram!.answerConfirm(false));await expect(sharing.getByRole('link',{name:'Отправить в WhatsApp',exact:true})).toBeVisible();
    await sharing.getByRole('button',{name:'Отключить ссылку',exact:true}).click();await page.evaluate(()=>window.__qadamTelegram!.answerConfirm(true));
    await expect(sharing.getByRole('button',{name:'Создать ссылку',exact:true})).toBeVisible();
    await expect(page.getByText('Открыть навигацию',{exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:/Повторить маршрут|Настройки геолокации|Принять заказ/})).toHaveCount(0);
    expect(courierRequests).toEqual([]);
  }finally{await request.post(`/api/orders/${order.id}/status`,{headers,data:{status:'CANCELLED'}});}
});
