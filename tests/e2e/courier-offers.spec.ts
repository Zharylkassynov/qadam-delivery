import {test,expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {signedTelegramData} from '../telegram-fixture';
import {miniApp} from './telegram-browser-fixture';
import {mockMapTiles} from './map-fixture';
import {enableShiftGps} from './courier-gps-fixture';
import type {Order,User} from '../../src/lib/types';

test.use({viewport:{width:390,height:844}});
test.skip(Boolean(process.env.E2E_ORIGIN),'Synthetic local identities only');
const origin='http://127.0.0.1:3100';
const headers=(token:string)=>({Origin:origin,Authorization:`Bearer ${token}`});
async function fixture(request:APIRequestContext){
  const url=process.env.TEST_DATABASE_URL;
  if(!url||!['localhost','127.0.0.1'].includes(new URL(url).hostname)||!new URL(url).pathname.endsWith('_test'))throw new Error('Separate local test database required');
  const db=new pg.Client({connectionString:url});await db.connect();
  async function account(name:string){
    const proof=signedTelegramData({id:9400000000000+Math.floor(Math.random()*1e9),first_name:name});
    const r=await request.post('/api/auth/telegram',{headers:{Origin:origin},data:{initData:proof}});expect(r.status()).toBe(200);
    return{...await r.json() as {user:User;sessionToken:string},proof};
  }
  const owner=await account('Выбор доставки — клиент'),courier=await account('Выбор доставки — курьер');
  await db.query("INSERT INTO qadam.user_profiles(user_id,phone,phone_verified,verified_at,last_telegram_update_id) VALUES($1,'+77005556677',true,now(),$2)",[owner.user.id,Date.now()]);
  await db.query("UPDATE qadam.users SET role='COURIER' WHERE id=$1",[courier.user.id]);
  await db.query("INSERT INTO qadam.courier_applications(user_id,phone,transport,status,reviewed_at,reviewed_by) VALUES($1,'+77000000000','FOOT','APPROVED',now(),$2)",[courier.user.id,owner.user.id]);
  async function create(){
    const r=await request.post('/api/orders',{headers:headers(owner.sessionToken),data:{requestKey:randomUUID(),pickupAddress:`Алматы, Абая 55, ${randomUUID().slice(0,6)}`,destinationAddress:'Алматы, Самал-3, 1',pickupPoint:{latitude:43.241,longitude:76.9},destinationPoint:{latitude:43.25,longitude:76.91},recipientName:'Скрытый получатель',recipientPhone:'+77001112233',parcelType:'PARCEL',fragile:true,surprise:true,urgent:true,payer:'RECIPIENT',paymentMethod:'CASH',pickupDetails:'Вход со двора',notes:'Небольшая коробка',shareContact:true}});
    expect(r.status()).toBe(201);return(await r.json()).order as Order;
  }
  async function cleanup(){await db.query('DELETE FROM qadam.orders WHERE customer_id=$1',[owner.user.id]);await db.query('DELETE FROM qadam.courier_applications WHERE user_id=$1',[courier.user.id]);await db.query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])',[[owner.user.id,courier.user.id]]);await db.end();}
  return{db,owner,courier,create,cleanup};
}

test('courier reviews addresses and critical terms before accepting; settings and map stay folded',async({page,request},info)=>{
  test.setTimeout(120000);const f=await fixture(request),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await mockMapTiles(page.context());
  try{
    const order=await f.create(),number=`QD-${order.number.padStart(4,'0')}`;
    await miniApp(page,f.courier.proof,844,'',{native:{theme:'light'}});
    const card=page.getByRole('button',{name:`Открыть заказ ${number}`,exact:true});await expect(card).toBeVisible();
    await expect(page.getByRole('button',{name:/^Принять/})).toHaveCount(0);
    await expect(page.locator('.courier-work-settings')).not.toHaveAttribute('open','');
    await expect(page.getByRole('button',{name:'Разрешить сообщения',exact:true})).not.toBeVisible();
    await expect(card).toContainText('Хрупкое');await expect(card).toContainText('Сюрприз');await expect(card).toContainText('Без задержки');
    await card.click();const preview=page.getByRole('region',{name:'Детали заказа'});
    await expect.poll(()=>page.evaluate(()=>window.__qadamTelegram!.main)).toMatchObject({text:'Принять заказ',active:false});
    await enableShiftGps(page);
    await expect.poll(()=>page.evaluate(()=>window.__qadamTelegram!.main.active)).toBe(true);
    await expect(preview).toContainText('Платит получатель · наличные');await expect(preview).toContainText('Вход со двора');await expect(preview).toContainText('Небольшая коробка');
    await expect(preview).not.toContainText('Скрытый получатель');await expect(preview).not.toContainText('+77001112233');
    await expect(preview.getByRole('link',{name:/Позвонить|2ГИС|Google Maps/})).toHaveCount(0);
    await expect(preview.locator('.delivery-map')).toHaveCount(0);
    await expect(page.getByText('После принятия ваш номер увидит отправитель.',{exact:true})).toBeVisible();
    for(const dark of [false,true]){
      await page.evaluate(dark=>window.__qadamTelegram!.changeTheme(dark),dark);
      for(const width of [320,390,768,1280]){
        await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        expect(await page.locator('.screen-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
        if(width===390)await page.screenshot({path:info.outputPath(`offer-${dark?'dark':'light'}.png`)});
      }
    }
    await page.setViewportSize({width:390,height:844});
    await preview.getByText('Посмотреть на карте',{exact:true}).click();await expect(preview.locator('.qadam-map-marker')).toHaveCount(2);
    await expect(preview.getByRole('button',{name:/Построить маршрут/})).toHaveCount(0);
    await preview.getByText('Условия доставки',{exact:true}).click();await expect(preview).toContainText('Согласуйте сумму до передачи посылки');
    await page.evaluate(()=>window.__qadamTelegram!.pressBack());
    await expect(page.getByRole('status',{name:'Можно принимать заказы',exact:true})).toBeVisible();
    await expect(card).toContainText(/До забора ≈ \d/);
    await expect(page.getByText(/^Позиция сохранена:/)).not.toBeVisible();
    for(const dark of [false,true]){
      await page.evaluate(dark=>window.__qadamTelegram!.changeTheme(dark),dark);
      for(const width of [320,390,768,1280]){
        await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        expect(await page.locator('.screen-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
        if(width===390)await page.screenshot({path:info.outputPath(`home-${dark?'dark':'light'}.png`)});
      }
    }
    await page.setViewportSize({width:390,height:844});await card.click();
    // Older Telegram renders the same action inside the page. Check that the
    // consent and button both fit instead of relying only on native SDK state.
    await page.context().grantPermissions(['geolocation']);await page.context().setGeolocation({latitude:43.24,longitude:76.9,accuracy:22});
    const fallback=await page.context().newPage();
    try{
      await miniApp(fallback,f.courier.proof,844,'',{query:`order=${order.id}`,native:{version:'5.0'}});
      await expect(fallback.getByRole('button',{name:'Принять заказ',exact:true})).toBeEnabled();
      await expect(fallback.getByText('После принятия ваш номер увидит отправитель.',{exact:true})).toBeVisible();
      for(const dark of [false,true]){
        await fallback.evaluate(dark=>window.__qadamTelegram!.changeTheme(dark),dark);
        await fallback.screenshot({path:info.outputPath(`offer-browser-${dark?'dark':'light'}.png`)});
      }
    }finally{await fallback.close();}
    await expect.poll(()=>page.evaluate(()=>window.__qadamTelegram!.main)).toMatchObject({text:'Принять заказ',active:true});
    await page.evaluate(()=>window.__qadamTelegram!.pressMain());
    await expect(page.getByRole('heading',{name:'Заберите посылку',exact:true})).toBeVisible();
    expect((await(await request.get(`/api/orders/${order.id}`,{headers:headers(f.owner.sessionToken)})).json()).order.courierId).toBe(f.courier.user.id);
    await page.evaluate(()=>window.__qadamTelegram!.pressBack());await expect(page.getByRole('button',{name:/Текущая доставка/})).toBeVisible();
    expect(errors).toEqual([]);
  }finally{await f.cleanup();}
});

test('courier offer handles expired windows, empty feed and failed refresh without enabling acceptance',async({page,request},info)=>{
  test.setTimeout(90000);const f=await fixture(request);await mockMapTiles(page.context());
  try{
    const order=await f.create();await f.db.query("UPDATE qadam.orders SET deliver_after=now()-interval '3 hours',deliver_before=now()-interval '1 hour' WHERE id=$1",[order.id]);
    await miniApp(page,f.courier.proof,844,'',{query:`order=${order.id}`});
    await expect(page.getByRole('button',{name:'Интервал истёк',exact:true})).toBeDisabled();
    await expect(page.getByText('Интервал доставки истёк',{exact:true})).toBeVisible();
    await expect(page.getByRole('switch',{name:'Я на линии'})).toHaveCount(0);
    expect((await request.post(`/api/orders/${order.id}/accept`,{headers:headers(f.courier.sessionToken),data:{shareContact:true}})).status()).toBe(409);
    await page.getByRole('button',{name:'Назад',exact:true}).click();
    await page.route('**/api/orders',route=>route.fulfill({json:{orders:[]}}));
    await page.getByRole('button',{name:'Обновить список',exact:true}).click();await expect(page.getByRole('heading',{name:'Коротких доставок пока нет',exact:true})).toBeVisible();
    await page.route('**/api/orders',route=>route.fulfill({status:503,json:{error:'Нет связи'}}));
    await page.getByRole('button',{name:'Обновить список',exact:true}).click();await expect(page.getByRole('main').getByRole('alert')).toContainText('Данные не обновлены');
    await page.screenshot({path:info.outputPath('courier-empty-offline.png')});
    await page.unroute('**/api/orders');await page.getByRole('button',{name:'Обновить список',exact:true}).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);await expect(page.getByRole('button',{name:`Открыть заказ QD-${order.number.padStart(4,'0')}`,exact:true})).toBeVisible();
  }finally{await f.cleanup();}
});
