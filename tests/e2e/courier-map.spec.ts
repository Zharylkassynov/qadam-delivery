import {expect,test,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {signedTelegramData} from '../telegram-fixture';
import {miniApp} from './telegram-browser-fixture';
import {enableShiftGps} from './courier-gps-fixture';
import {mockMapTiles} from './map-fixture';
test.skip(Boolean(process.env.E2E_ORIGIN),'Synthetic local identities only');
const origin='http://127.0.0.1:3100';
const headers=(token:string)=>({Origin:origin,Authorization:`Bearer ${token}`});
async function fixture(request:APIRequestContext){
  const url=process.env.TEST_DATABASE_URL;if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Separate _test database required');
  const db=new pg.Client({connectionString:url});await db.connect();
  async function account(name:string){const id=4600000000000+Math.floor(Math.random()*1000000000);const proof=signedTelegramData({id,first_name:name});const r=await request.post('/api/auth/telegram',{headers:{Origin:origin},data:{initData:proof}});expect(r.status()).toBe(200);return {...await r.json(),proof};}
  const customer=await account('Карта — клиент'),courier=await account('Карта — курьер');
  await db.query("UPDATE qadam.users SET role='COURIER' WHERE id=$1",[courier.user.id]);
  async function cleanup(){await db.query('DELETE FROM qadam.orders WHERE customer_id=$1',[customer.user.id]);await db.query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])',[[customer.user.id,courier.user.id]]);await db.end();}
  return {db,customer,courier,cleanup};
}
test('shift GPS survives navigation and reload, pauses on hide, resumes, and changes a public marker to private order tracking',async({browser,request},info)=>{
  test.setTimeout(120000);const f=await fixture(request);
  const clientContext=await browser.newContext({viewport:{width:390,height:844}}),courierContext=await browser.newContext({viewport:{width:390,height:844}});
  await mockMapTiles(clientContext);await mockMapTiles(courierContext);
  const client=await clientContext.newPage(),courier=await courierContext.newPage();let fixes=0;
  courier.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/courier/location')&&'latitude' in r.postDataJSON())fixes++;});
  try{
    await miniApp(client,f.customer.proof,844);await miniApp(courier,f.courier.proof,844);
    await courier.evaluate(()=>{document.documentElement.dataset.gpsLatitude='43.241123';document.documentElement.dataset.gpsLongitude='76.895678';});
    await courier.getByRole('switch',{name:'Я на линии'}).click();await enableShiftGps(courier);
    await client.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect(client.locator('.qadam-map-marker.approximate').first()).toBeVisible({timeout:20000});
    const publicRows=(await(await request.get('/api/couriers/nearby',{headers:headers(f.customer.sessionToken)})).json()).couriers;
    const point=publicRows.find((p:{latitude:number})=>Math.abs(p.latitude-43.241123)<.005);expect(point).toBeTruthy();expect(point.latitude).not.toBe(43.241123);expect(Object.keys(point).sort()).toEqual(['capturedAt','count','latitude','longitude']);
    await client.screenshot({path:info.outputPath('customer-free-couriers.png'),fullPage:true});
    await courier.getByRole('navigation',{name:'Мобильная навигация'}).getByRole('button',{name:'Профиль',exact:true}).click();
    await courier.getByRole('navigation',{name:'Мобильная навигация'}).getByRole('button',{name:'Доступные',exact:true}).click();
    await expect(courier.getByText('Позиция передаётся',{exact:true})).toBeVisible();
    await courier.reload();await expect(courier.getByText('Позиция передаётся',{exact:true})).toBeVisible();
    await courier.screenshot({path:info.outputPath('courier-shift-gps.png'),fullPage:true});
    await expect(courier.getByRole('checkbox',{name:'Разрешаю показывать мою позицию во время смены.'})).toHaveCount(0);
    const r=await request.post('/api/orders',{headers:headers(f.customer.sessionToken),data:{requestKey:randomUUID(),pickupAddress:`Карта ${randomUUID().slice(0,6)}, Абая 10`,destinationAddress:'Алматы, Ауэзова 20',recipientName:'Получатель карты',recipientPhone:'+77000000000',notes:''}});expect(r.status()).toBe(201);const {order}=await r.json();
    expect((await request.post(`/api/orders/${order.id}/accept`,{headers:headers(f.courier.sessionToken),data:{}})).status()).toBe(200);
    await client.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(client.locator('.customer-map-status')).toContainText('Ваш курьер');
    await expect(client.locator('.qadam-map-marker.approximate')).toHaveCount(0);await expect(client.locator('.qadam-map-marker.courier')).toHaveCount(1);
    await client.getByRole('button',{name:'Открыть доставку',exact:true}).click();await expect(client.getByRole('region',{name:'Детали заказа'})).toContainText('Точность: около 22 м.');
    const before=fixes;await courier.clock.install();
    await courier.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    await courier.clock.fastForward(16000);expect(fixes).toBe(before);
    // Browser time advanced; keep the server throttle independent of that clock.
    await f.db.query("UPDATE qadam.courier_presence SET received_at=clock_timestamp()-interval '6 seconds' WHERE user_id=$1",[f.courier.user.id]);
    await courier.evaluate(()=>{document.documentElement.dataset.gpsLatitude='43.252';Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
    await expect.poll(()=>fixes).toBeGreaterThan(before);
    await expect.poll(async()=>{const d=await(await request.get(`/api/orders/${order.id}`,{headers:headers(f.customer.sessionToken)})).json();return d.order.courierLocation.latitude;}).toBe(43.252);
    await client.screenshot({path:info.outputPath('customer-assigned-courier.png'),fullPage:true});
    await courier.getByRole('switch',{name:'Я на линии'}).click();await expect(courier.getByRole('switch',{name:'Я на линии'})).toHaveAttribute('aria-checked','false');
    for(const s of ['PICKED_UP','IN_TRANSIT','DELIVERED'])expect((await request.post(`/api/orders/${order.id}/status`,{headers:headers(f.courier.sessionToken),data:{status:s}})).status()).toBe(200);
    const after=fixes;await courier.clock.fastForward(16000);expect(fixes).toBe(after);
    await expect(client.getByRole('heading',{name:'Посылка у получателя',exact:true})).toBeVisible();
  }finally{await clientContext.close();await courierContext.close();await f.cleanup();}
});
test('denied GPS requests no repeating permission dialogs and preserves the shift and order access',async({page,request},info)=>{
  const f=await fixture(request);await mockMapTiles(page.context());
  try{
    await miniApp(page,f.courier.proof,844,'',{location:'deny'});await page.getByRole('switch',{name:'Я на линии'}).click();await enableShiftGps(page,false);
    await expect(page.locator('.courier-gps')).toContainText('Геолокация не разрешена');
    expect(await page.evaluate(()=>document.documentElement.dataset.locationRequests)).toBe('1');
    await page.clock.install();await page.clock.fastForward(20000);
    expect(await page.evaluate(()=>document.documentElement.dataset.locationRequests)).toBe('1');
    await page.getByRole('button',{name:'Открыть настройки геолокации'}).click();expect(await page.evaluate(()=>document.documentElement.dataset.locationSettings)).toBe('opened');
    await page.reload();await expect(page.locator('.courier-gps')).toContainText('Геолокация не разрешена');
    expect(await page.evaluate(()=>document.documentElement.dataset.locationRequests)).toBeUndefined();
    await expect(page.getByRole('heading',{name:'Можно принять',exact:true})).toBeVisible();
    for(const width of [320,360,390,1440]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:info.outputPath('courier-gps-denied.png'),fullPage:true});
  }finally{await f.cleanup();}
});
