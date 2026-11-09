import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {signedTelegramData} from '../telegram-fixture';
import {miniApp} from './telegram-browser-fixture';
import {mockMapTiles} from './map-fixture';
import {enableShiftGps} from './courier-gps-fixture';
import type {LocationStreamStatus} from '../../src/lib/location-consent';

test.skip(Boolean(process.env.E2E_ORIGIN),'Synthetic local accounts only');
test.use({baseURL:'http://127.0.0.1:3104',viewport:{width:390,height:844}});
const origin='http://127.0.0.1:3104';

test('photo order keeps one navigation panel through pending requests, polling, status changes and reopening',async({page,request},info)=>{
  test.setTimeout(90000);
  const url=process.env.TEST_DATABASE_URL;
  if(!url||!new URL(url).pathname.endsWith('_test')||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('Local _test database required');
  const db=new pg.Client({connectionString:url});await db.connect();
  const ids:string[]=[],telegramIds:number[]=[],errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  let release!:()=>void;
  const responseReady=new Promise<void>(resolve=>{release=resolve;});
  let checks=0,status:LocationStreamStatus={enabled:true,pilotOnly:true,allowed:false,stream:null};
  try{
    async function account(name:string){
      const telegramId=5950000000000+Math.floor(Math.random()*1000000000),proof=signedTelegramData({id:telegramId,first_name:name});
      const response=await request.post('/api/auth/telegram',{headers:{Origin:origin},data:{initData:proof}});expect(response.status()).toBe(200);
      const data=await response.json();ids.push(data.user.id);telegramIds.push(telegramId);return{...data,proof};
    }
    const customer=await account('Проверка панелей — отправитель'),courier=await account('Проверка панелей — курьер');
    await db.query("UPDATE qadam.users SET role='COURIER' WHERE id=$1",[courier.user.id]);
    const created=await request.post('/api/orders',{headers:{Origin:origin,Authorization:`Bearer ${customer.sessionToken}`},data:{requestKey:randomUUID(),pickupAddress:'Алматы, Абая 100',destinationAddress:'Алматы, Самал 111',recipientName:'Получатель проверки панелей',recipientPhone:'+77000000000',notes:'Проверка обновления панелей'}});
    expect(created.status()).toBe(201);const {order}=await created.json();expect(order.photoRequired).toBe(true);
    await mockMapTiles(page.context());await miniApp(page,courier.proof,844,origin,{query:`order=${order.id}`});
    // Hold the initial stream response while the real order continues to poll.
    // This exposes orphaned loading panels caused by colliding sibling keys.
    await page.route(`**/api/orders/${order.id}/location-stream`,async route=>{
      checks++;await responseReady;
      if(!page.isClosed())await route.fulfill({json:status});
    });
    await enableShiftGps(page);await page.getByRole('button',{name:'Принять заказ',exact:true}).click();
    const panel=page.locator('.location-stream');
    await expect.poll(()=>checks).toBeGreaterThan(0);
    let revision=0;
    async function refreshOrder(){
      const notes=`Проверка обновления панелей ${++revision}`;
      await db.query('UPDATE qadam.orders SET notes=$2 WHERE id=$1',[order.id,notes]);
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await expect(page.getByText(notes,{exact:true})).toBeVisible();
    }
    for(let n=0;n<3;n++)await refreshOrder();
    await page.screenshot({path:info.outputPath('navigation-panel-pending.png'),fullPage:true});
    await expect(panel).toHaveCount(1);
    await expect(page.locator('.order-trust')).toHaveCount(1);
    release();await expect(panel).toHaveCount(0);
    await expect(page.getByText(/Закрытая проверка: подключение доступно/)).toHaveCount(0);
    await expect(page.getByText('Проверяем возможность подключения…',{exact:true})).toHaveCount(0);
    for(let n=0;n<2;n++){await refreshOrder();await expect(panel).toHaveCount(0);}
    status={...status,enabled:false};await expect(panel).toHaveCount(0);
    await refreshOrder();await expect(panel).toHaveCount(0);
    status={...status,enabled:true,allowed:true};
    await page.getByRole('button',{name:'Назад',exact:true}).click();
    await page.getByRole('navigation',{name:'Мобильная навигация'}).getByRole('button',{name:'Мои заказы',exact:true}).click();
    await page.getByRole('button',{name:/^Открыть заказ/}).filter({hasText:'Абая 100'}).click();
    await expect(panel).toHaveCount(1);
    await page.getByRole('button',{name:'Подключить трансляцию Telegram',exact:true}).click();
    const consent=page.getByRole('checkbox',{name:'Разрешаю использовать мою трансляцию Telegram для этого заказа до завершения или отключения.'});
    await consent.check();await refreshOrder();await expect(consent).toBeChecked();await expect(panel).toHaveCount(1);
    await page.getByRole('button',{name:'Посылка у меня',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Посылка у вас',exact:true})).toBeVisible();
    await refreshOrder();await expect(panel).toHaveCount(1);await expect(consent).toBeChecked();
    await expect(page.locator('.order-trust')).toHaveCount(1);
    await page.getByRole('button',{name:'Оставить GPS открытого Qadam',exact:true}).click();
    await panel.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('navigation-panel-single-mobile.png'),fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  }finally{
    release();await page.close();
    try{
      await db.query('DELETE FROM qadam.orders WHERE customer_id=ANY($1::uuid[])',[ids]);
      await db.query('DELETE FROM qadam.telegram_outbox WHERE telegram_user_id=ANY($1::bigint[])',[telegramIds]);
      await db.query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])',[ids]);
    }finally{await db.end();}
  }
});
