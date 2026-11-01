import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {signedTelegramData} from '../telegram-fixture';
import {miniApp} from './telegram-browser-fixture';
import {mockMapTiles} from './map-fixture';
import {enableShiftGps} from './courier-gps-fixture';

test.skip(Boolean(process.env.E2E_ORIGIN),'Synthetic local accounts and webhook only');
test('saved GPS consent survives shifts and a private Telegram stream updates the customer while the courier Mini App is closed',async({browser,request},info)=>{
  test.setTimeout(150000);
  const url=process.env.TEST_DATABASE_URL;
  if(!url||!new URL(url).pathname.endsWith('_test')||!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw new Error('Local _test database required');
  const db=new pg.Client({connectionString:url});await db.connect();
  const origin='http://127.0.0.1:3100',ids:string[]=[],updateIds:number[]=[],contexts:Awaited<ReturnType<typeof browser.newContext>>[]=[];
  const errors:string[]=[];
  async function account(name:string){
    const telegramId=5700000000000+Math.floor(Math.random()*1000000000),proof=signedTelegramData({id:telegramId,first_name:name});
    const response=await request.post('/api/auth/telegram',{headers:{Origin:origin},data:{initData:proof}});expect(response.status()).toBe(200);
    const data=await response.json();ids.push(data.user.id);return{...data,telegramId,proof};
  }
  const headers=(account:{sessionToken:string})=>({Origin:origin,Authorization:`Bearer ${account.sessionToken}`});
  async function pageFor(account:{proof:string},query=''){
    const context=await browser.newContext({viewport:{width:390,height:844},geolocation:{latitude:43.23,longitude:76.88},permissions:['geolocation']});contexts.push(context);await mockMapTiles(context);
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await miniApp(page,account.proof,760,origin,{query});return page;
  }
  try{
    const owner=await account('Клиент трансляции'),courier=await account('Курьер трансляции');
    await db.query("UPDATE qadam.users SET role='COURIER' WHERE id=$1",[courier.user.id]);await db.query('INSERT INTO qadam.administrators(user_id) VALUES($1)',[courier.user.id]);
    let courierPage=await pageFor(courier);await courierPage.getByRole('switch',{name:'Я на линии'}).click();await enableShiftGps(courierPage);
    await courierPage.getByRole('switch',{name:'Я на линии'}).click();await expect(courierPage.getByRole('switch',{name:'Я на линии'})).toHaveAttribute('aria-checked','false');
    await courierPage.getByRole('switch',{name:'Я на линии'}).click();await expect(courierPage.getByText(/^Позиция сохранена:/)).toBeVisible();
    await expect(courierPage.getByRole('checkbox',{name:'Разрешаю автоматически включать передачу геопозиции при выходе на линию.'})).toHaveCount(0);
    const created=await request.post('/api/orders',{headers:headers(owner),data:{requestKey:randomUUID(),pickupAddress:'Алматы, Абая 100',destinationAddress:'Алматы, Самал 111',recipientName:'Получатель трансляции',recipientPhone:'+77000000000',pickupPoint:{latitude:43.24,longitude:76.9},destinationPoint:{latitude:43.25,longitude:76.91}}});expect(created.status()).toBe(201);const order=(await created.json()).order;
    expect((await request.post(`/api/orders/${order.id}/accept`,{headers:headers(courier),data:{}})).status()).toBe(200);
    await courierPage.close();courierPage=await pageFor(courier,`order=${order.id}`);const customerPage=await pageFor(owner,`order=${order.id}`);
    await courierPage.getByRole('button',{name:'Подключить трансляцию Telegram',exact:true}).click();
    await courierPage.getByRole('checkbox',{name:'Разрешаю использовать мою трансляцию Telegram для этого заказа до завершения или отключения.'}).check();
    await courierPage.getByRole('button',{name:'Разрешить трансляцию для заказа',exact:true}).click();await expect(courierPage.getByText('Ожидаем трансляцию из Telegram',{exact:true})).toBeVisible();
    await courierPage.getByRole('heading',{name:'Позиция во время навигации',exact:true}).scrollIntoViewIfNeeded();await courierPage.screenshot({path:info.outputPath('location-waiting-mobile.png')});
    const date=Math.floor(Date.now()/1000)+1,message={message_id:1234,date,from:{id:courier.telegramId,is_bot:false},chat:{id:courier.telegramId,type:'private'},location:{latitude:43.241,longitude:76.901,horizontal_accuracy:30,live_period:900}};
    async function webhook(m:unknown,edited=false){const id=Date.now()*100+updateIds.length;updateIds.push(id);const response=await request.post('/api/telegram/webhook',{headers:{'X-Telegram-Bot-Api-Secret-Token':'synthetic_location_webhook_secret_abcdefghijklmnopqrstuvwxyz'},data:{update_id:id,[edited?'edited_message':'message']:m}});expect(response.status()).toBe(200);}
    await webhook(message);await expect(courierPage.getByText('Обновления из Telegram',{exact:true})).toBeVisible();
    await expect(customerPage.getByText('Источник — трансляция Telegram. Частота обновлений зависит от телефона и связи.',{exact:true})).toBeVisible();
    await courierPage.getByRole('heading',{name:'Позиция во время навигации',exact:true}).scrollIntoViewIfNeeded();await courierPage.screenshot({path:info.outputPath('location-live-mobile.png')});
    await courierPage.close();await webhook({...message,edit_date:Math.floor(Date.now()/1000)+2,location:{...message.location,latitude:43.252}},true);
    await expect.poll(async()=>((await (await request.get(`/api/orders/${order.id}`,{headers:headers(owner)})).json()).order.courierLocation?.latitude)).toBe(43.252);
    await db.query("UPDATE qadam.courier_locations SET captured_at=clock_timestamp()-interval '2 minutes' WHERE order_id=$1",[order.id]);
    await expect(customerPage.getByText('Позиция курьера устарела',{exact:true})).toBeVisible({timeout:20000});await customerPage.getByRole('heading',{name:'Доставка на карте',exact:true}).scrollIntoViewIfNeeded();await customerPage.screenshot({path:info.outputPath('location-stale-customer.png')});
    courierPage=await pageFor(courier,`order=${order.id}`);await courierPage.getByRole('button',{name:'Остановить использование в Qadam',exact:true}).click();
    await expect(courierPage.getByText('Использование трансляции в Qadam остановлено. Остановите её также в чате Telegram.',{exact:true})).toBeVisible();
    const before=(await db.query('SELECT update_count FROM qadam.order_location_streams WHERE order_id=$1',[order.id])).rows[0].update_count;
    await webhook({...message,edit_date:Math.floor(Date.now()/1000)+3,location:{...message.location,latitude:43.26}},true);
    expect((await db.query('SELECT update_count FROM qadam.order_location_streams WHERE order_id=$1',[order.id])).rows[0].update_count).toBe(before);
    await courierPage.getByRole('button',{name:'Настройки геолокации',exact:true}).click();await courierPage.getByRole('button',{name:'Отозвать согласие и остановить',exact:true}).click();
    await expect(courierPage.getByText('Передача в Qadam остановлена. Остановите трансляцию также в чате Telegram.',{exact:true})).toBeVisible();
    expect((await db.query('SELECT auto_location_enabled,sharing FROM qadam.courier_presence WHERE user_id=$1',[courier.user.id])).rows[0]).toEqual({auto_location_enabled:false,sharing:false});
    expect(errors).toEqual([]);
  }finally{
    for(const context of contexts)await context.close();
    await db.query('DELETE FROM qadam.telegram_updates WHERE update_id=ANY($1::bigint[])',[updateIds]);
    await db.query('DELETE FROM qadam.orders WHERE customer_id=ANY($1::uuid[])',[ids]);await db.query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])',[ids]);await db.end();
  }
});
