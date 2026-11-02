import {test,expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {signedTelegramData} from '../telegram-fixture';
import {miniApp} from './telegram-browser-fixture';
import {enableShiftGps} from './courier-gps-fixture';
import {mockMapTiles} from './map-fixture';
test.skip(Boolean(process.env.E2E_ORIGIN),'Local synthetic accounts only');
const origin='http://127.0.0.1:3100';
const headers=(token:string)=>({Origin:origin,Authorization:`Bearer ${token}`});
async function fixture(request:APIRequestContext){
  const url=process.env.TEST_DATABASE_URL;if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Separate test database required');
  const db=new pg.Client({connectionString:url});await db.connect();
  async function account(name:string){const proof=signedTelegramData({id:5900000000000+Math.floor(Math.random()*1000000000),first_name:name});const r=await request.post('/api/auth/telegram',{headers:{Origin:origin},data:{initData:proof}});expect(r.status()).toBe(200);return{...await r.json(),proof};}
  const customer=await account('Готовность — клиент'),courier=await account('Готовность — курьер');
  await db.query("UPDATE qadam.users SET role='COURIER' WHERE id=$1",[courier.user.id]);
  async function create(){const r=await request.post('/api/orders',{headers:headers(customer.sessionToken),data:{requestKey:randomUUID(),pickupAddress:`Готовность ${randomUUID().slice(0,6)}, Абая 52`,destinationAddress:'Алматы, Сатпаева 30',recipientName:'Получатель',recipientPhone:'+77000000000',notes:''}});expect(r.status()).toBe(201);return(await r.json()).order;}
  async function cleanup(){await db.query('DELETE FROM qadam.orders WHERE customer_id=$1',[customer.user.id]);await db.query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])',[[customer.user.id,courier.user.id]]);await db.end();}
  return{db,customer,courier,create,cleanup};
}

test('permission denial blocks new acceptance; fresh GPS enables it and shift ends only after delivery',async({page,request},info)=>{
  test.setTimeout(120000);const f=await fixture(request);await page.setViewportSize({width:390,height:844});await mockMapTiles(page.context());
  try{
    const order=await f.create();expect((await request.post(`/api/orders/${order.id}/accept`,{headers:headers(f.courier.sessionToken),data:{}})).status()).toBe(409);
    await miniApp(page,f.courier.proof,844,'',{query:`order=${order.id}`,location:'deny'});
    await expect(page.getByRole('button',{name:'Принять заказ',exact:true})).toBeDisabled();await enableShiftGps(page,false);
    await expect(page.locator('.gps-error')).toContainText('Доступ к геолокации не предоставлен');
    expect(await page.evaluate(()=>document.documentElement.dataset.locationRequests)).toBe('1');
    await expect(page.getByRole('button',{name:'Принять заказ',exact:true})).toBeDisabled();
    await page.getByRole('heading',{name:'Геопозиция нужна для заказов',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath('readiness-denied-mobile.png'),fullPage:true});
    await miniApp(page,f.courier.proof,844,'',{query:`order=${order.id}`,location:'allow'});await page.reload();await enableShiftGps(page);
    await page.locator('.courier-shift').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('readiness-ready-mobile.png'),fullPage:true});
    await expect(page.getByRole('button',{name:'Принять заказ',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Принять заказ',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Заберите посылку',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Назад',exact:true}).click();
    await page.getByRole('button',{name:'Закончить после доставки',exact:true}).click({timeout:25000});
    await expect(page.getByText('Смена закончится после доставки',{exact:true})).toBeVisible();
    await page.getByText('Смена закончится после доставки',{exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath('readiness-ending-mobile.png'),fullPage:true});
    const next=await f.create();expect((await request.post(`/api/orders/${next.id}/accept`,{headers:headers(f.courier.sessionToken),data:{}})).status()).toBe(409);
    expect((await request.post(`/api/orders/${order.id}/accept`,{headers:headers(f.courier.sessionToken),data:{}})).status()).toBe(200);
    for(const status of ['PICKED_UP','IN_TRANSIT','DELIVERED'])expect((await request.post(`/api/orders/${order.id}/status`,{headers:headers(f.courier.sessionToken),data:{status}})).status()).toBe(200);
    await expect.poll(async()=>((await(await request.get('/api/courier/status',{headers:headers(f.courier.sessionToken)})).json()).status.online)).toBe(false);
    const stored=(await(await request.get(`/api/orders/${order.id}`,{headers:headers(f.customer.sessionToken)})).json()).order;
    expect(stored.status).toBe('DELIVERED');expect(stored.courierLocation).toBeTruthy();expect(stored.courierLocation.sharingStopped).toBe(true);
  }finally{await f.cleanup();}
});

test('checkout shows real rounded courier positions, preserves the form and survives empty or failed map updates',async({browser,request},info)=>{
  test.setTimeout(100000);const f=await fixture(request),clientContext=await browser.newContext({viewport:{width:390,height:844}}),courierContext=await browser.newContext({viewport:{width:390,height:844}});
  await mockMapTiles(clientContext);await mockMapTiles(courierContext);const client=await clientContext.newPage(),courier=await courierContext.newPage();
  try{
    await miniApp(courier,f.courier.proof,844);await enableShiftGps(courier);await miniApp(client,f.customer.proof,844);
    await client.getByRole('button',{name:'Указать адреса',exact:true}).click();
    await client.getByLabel('Адрес отправления',{exact:true}).fill('Алматы, Абая 52');await client.getByRole('button',{name:'Выбрать адрес',exact:true}).click();
    await client.getByLabel('Адрес доставки',{exact:true}).fill('Алматы, Сатпаева 30');await client.getByRole('button',{name:'Выбрать адрес',exact:true}).click();
    await client.getByRole('button',{name:'Далее — получатель',exact:true}).click();
    const panel=client.locator('.checkout-couriers');await expect(panel.locator('summary')).toContainText('Курьеры рядом');
    await panel.locator('summary').click();await expect(panel.locator('.qadam-map-marker.approximate').first()).toBeVisible({timeout:20000});
    await client.getByLabel('Имя получателя',{exact:true}).fill('Получатель карты');await client.getByLabel('Телефон получателя',{exact:true}).fill('+77000000000');
    await panel.locator('summary').scrollIntoViewIfNeeded();
    await client.screenshot({path:info.outputPath('checkout-couriers-recipient.png'),fullPage:true});
    await client.getByRole('button',{name:'Проверить заказ',exact:true}).click();await expect(panel.locator('summary')).toContainText('Курьеры рядом');
    await panel.locator('summary').click();await expect(panel.locator('.qadam-map-marker.approximate').first()).toBeVisible();
    await client.route('**/api/couriers/nearby?*',route=>route.fulfill({status:503,json:{error:'Не удалось обновить позиции'}}));
    const failure=client.waitForResponse(response=>response.url().includes('/api/couriers/nearby?')&&response.status()===503,{timeout:25000});
    await client.evaluate(()=>window.dispatchEvent(new Event('focus')));await failure;await expect(panel).toContainText('Не удалось обновить позиции');
    await expect(client.getByRole('button',{name:'Подтвердить заказ',exact:true})).toBeEnabled();
    await client.route('**/api/couriers/nearby?*',route=>route.fulfill({json:{couriers:[]}}));await panel.getByRole('button',{name:'Повторить обновление',exact:true}).click();
    await expect(panel).toContainText('Свежих позиций пока нет');await expect(client.locator('.review-section').filter({has:client.getByRole('heading',{name:'Получатель',exact:true})})).toContainText('Получатель карты');
    for(const width of [320,390,1280]){await client.setViewportSize({width,height:900});expect(await client.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
    await courier.getByRole('button',{name:'Настройки геолокации',exact:true}).click();
    await courier.getByRole('button',{name:'Отозвать согласие и остановить',exact:true}).click();
    await expect(courier.getByText('Передача в Qadam остановлена. Остановите трансляцию также в чате Telegram.',{exact:true})).toBeVisible();
    await courier.getByRole('button',{name:'Выйти на линию',exact:true}).click();
    await expect(courier.getByRole('checkbox',{name:/^Разрешаю использовать мою геопозицию/})).not.toBeChecked();
  }finally{await clientContext.close();await courierContext.close();await f.cleanup();}
});
