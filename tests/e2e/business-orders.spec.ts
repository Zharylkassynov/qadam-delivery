import { test,expect,type APIRequestContext,type BrowserContext,type Page } from '@playwright/test';
import pg from 'pg';
import { signedTelegramData } from '../telegram-fixture';
import { miniApp } from './telegram-browser-fixture';
import { mockMapTiles } from './map-fixture';
import { saveTelegramContact } from '../../src/lib/user-profiles';
import { closeDatabase } from '../../src/lib/db';
test.skip(Boolean(process.env.E2E_ORIGIN),'Synthetic local business accounts only');
test.use({viewport:{width:390,height:844}});
const origin='http://127.0.0.1:3100';
const shopName='Цветочная «Лепесток»';
const a={id:'business-a',address:'Абая, 100',detail:'Алматы',precision:'building',latitude:43.24,longitude:76.9};
const b={...a,id:'business-b',address:'Самал-2, 111',latitude:43.25,longitude:76.91};
async function account(request:APIRequestContext,name:string){
  const telegramId=5100000000000+Math.floor(Math.random()*1000000000),proof=signedTelegramData({id:telegramId,first_name:name});
  const response=await request.post('/api/auth/telegram',{headers:{Origin:origin},data:{initData:proof}});expect(response.status()).toBe(200);
  return {...await response.json(),proof,telegramId};
}
async function maps(context:BrowserContext,page:Page){
  await mockMapTiles(context);
  await page.route('**/api/orders/*/route',route=>route.fulfill({json:{route:{mode:'drive',distanceMeters:2400,paths:[[[a.latitude,a.longitude],[b.latitude,b.longitude]]]}}}));
  await page.route('**/api/geocoding',route=>route.fulfill({json:{results:[route.request().postDataJSON().query.includes('Самал')?b:a]}}));
}
async function address(page:Page,label:string,value:string){
  await page.getByLabel(label,{exact:true}).fill(value);await page.getByRole('button',{name:'Найти адрес',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Найденный адрес',exact:true})).toBeVisible();await page.getByRole('button',{name:'Выбрать адрес',exact:true}).click();
}
const nav=(page:Page,name:string)=>page.getByRole('navigation',{name:'Мобильная навигация',exact:true}).getByRole('button',{name,exact:true}).click();

test('one customer can save a shop, schedule a private delivery, remove the shop and repeat from history as a personal order',async({browser,request},info)=>{
  test.setTimeout(120000);
  const url=process.env.TEST_DATABASE_URL;
  if(!url||!new URL(url).pathname.endsWith('_test')||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('Separate local _test database required');
  process.env.DATABASE_URL=url;
  const db=new pg.Client({connectionString:url});await db.connect();
  const customer=await account(request,'Клиент магазина'),courier=await account(request,'Курьер магазина'),other=await account(request,'Другой клиент магазина');
  const contexts:BrowserContext[]=[],errors:string[]=[];
  try{
    await db.query('UPDATE qadam.pricing_settings SET active=false');
    await db.query(`INSERT INTO qadam.courier_applications(user_id,phone,transport,status,reviewed_at,reviewed_by) VALUES($1,'+77000000033','CAR','APPROVED',now(),$2)`,[courier.user.id,customer.user.id]);
    const context=await browser.newContext({viewport:{width:390,height:844}});contexts.push(context);
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await miniApp(page,customer.proof,760,'',{contact:'allow'});await maps(context,page);
    await expect(page.getByRole('heading',{name:'Куда доставить?',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Из магазина',exact:true})).toHaveCount(0);
    await nav(page,'Профиль');await page.getByRole('button',{name:'Мой магазин',exact:true}).click();
    await page.getByRole('button',{name:'Добавить магазин',exact:true}).click();
    await page.getByRole('button',{name:'Сохранить магазин',exact:true}).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Укажите название');
    await page.getByLabel('Название магазина',{exact:true}).fill(shopName);
    await page.getByLabel('Как найти вход',{exact:true}).fill('Вход со двора');
    await page.getByRole('button',{name:'Выбрать адрес и точку',exact:true}).click();
    await address(page,'Адрес отправления','Абая, 100');
    await expect(page.getByLabel('Название магазина',{exact:true})).toHaveValue(shopName);
    await page.getByRole('button',{name:'Сохранить магазин',exact:true}).click();
    await expect(page.locator('.app-bar p')).toHaveText('Телефон для связи');
    await page.getByRole('button',{name:'Поделиться номером',exact:true}).click();
    await saveTelegramContact(String(customer.telegramId),'+77000000042',Date.now());
    await expect(page.getByText('Номер получен из Telegram',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Вернуться к магазину',exact:true}).click();
    await expect(page.getByLabel('Название магазина',{exact:true})).toHaveValue(shopName);
    const saved=page.waitForResponse(r=>r.url().endsWith('/api/business-profile')&&r.request().method()==='PUT');
    await page.getByRole('button',{name:'Сохранить магазин',exact:true}).click();expect((await saved).status()).toBe(200);
    await expect(page.getByRole('heading',{name:shopName,exact:true})).toBeVisible();
    for(const width of [320,390,1280]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`shop-saved-${width}.png`)});}
    await page.setViewportSize({width:390,height:844});
    expect(await (await request.get('/api/business-profile',{headers:{Authorization:`Bearer ${other.sessionToken}`}})).json()).toEqual({profile:null});
    await page.getByRole('button',{name:'Заказать из магазина',exact:true}).click();
    await expect(page.getByRole('button',{name:'Из магазина',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.getByRole('button',{name:'С другого адреса',exact:true}).click();
    await expect(page.getByRole('button',{name:'Изменить адрес отправления',exact:true})).toContainText('Откуда забрать?');
    await page.getByRole('button',{name:'Из магазина',exact:true}).click();
    await expect(page.getByRole('button',{name:'Изменить адрес отправления',exact:true})).toContainText('Абая, 100');
    await page.getByRole('button',{name:'Указать адреса',exact:true}).click();await address(page,'Адрес доставки','Самал-2, 111');
    await page.getByRole('button',{name:'Далее — получатель',exact:true}).click();
    await page.getByLabel('Имя получателя',{exact:true}).fill('Получатель цветов');await page.getByLabel('Телефон получателя',{exact:true}).fill('+77000000011');
    await page.getByRole('button',{name:'Цветы',exact:true}).click();
    await page.getByRole('button',{name:'Ко времени',exact:true}).click();
    const date=new Date(Date.now()+86400_000+5*3600_000).toISOString().slice(0,10);
    await page.getByLabel('Дата доставки',{exact:true}).fill(date);await page.getByLabel('С',{exact:true}).fill('14:00');await page.getByLabel('До',{exact:true}).fill('14:15');
    await page.getByRole('button',{name:'Проверить заказ',exact:true}).click();await expect(page.getByText('Выберите интервал не меньше 30 минут.',{exact:true})).toBeVisible();
    await page.getByLabel('До',{exact:true}).fill('15:00');
    await page.getByRole('checkbox',{name:/^Хрупкое/}).check();await page.getByRole('checkbox',{name:/^Сюрприз для получателя/}).check();
    await page.getByRole('checkbox',{name:/^Важно доставить без задержки/}).check();
    await page.getByRole('checkbox',{name:'Добавить текст открытки',exact:true}).check();await page.getByLabel('Текст открытки',{exact:true}).fill('Приватное поздравление только назначенному курьеру');
    for(const width of [320,390]){await page.setViewportSize({width,height:844});await page.getByRole('heading',{name:'Что отправляем',exact:true}).scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`parcel-details-${width}.png`)});}
    await page.getByRole('button',{name:'Проверить заказ',exact:true}).click();await expect(page.getByRole('heading',{name:'Всё верно?',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Подтвердить заказ',exact:true})).toBeEnabled();await page.screenshot({path:info.outputPath('scheduled-review-390.png')});
    const creation=page.waitForResponse(r=>r.url().endsWith('/api/orders')&&r.request().method()==='POST');await page.getByRole('button',{name:'Подтвердить заказ',exact:true}).click();
    const response=await creation;expect(response.status()).toBe(201);const {order}=await response.json();
    expect(order.businessName).toBe(shopName);expect(order.parcelType).toBe('FLOWERS');expect(order.fragile).toBe(true);expect(order.deliverAfter).toContain('09:00:00');
    const hidden=await request.get(`/api/orders/${order.id}`,{headers:{Authorization:`Bearer ${courier.sessionToken}`}});expect(hidden.status()).toBe(200);expect((await hidden.json()).order.cardText).toBeNull();
    const courierContext=await browser.newContext({viewport:{width:390,height:844}});contexts.push(courierContext);
    const courierPage=await courierContext.newPage();courierPage.on('pageerror',e=>errors.push(e.message));await miniApp(courierPage,courier.proof,760);await maps(courierContext,courierPage);
    await courierPage.getByRole('button',{name:`Открыть заказ QD-${order.number.padStart(4,'0')}`,exact:true}).click();
    await expect(courierPage.getByText(order.cardText,{exact:true})).toHaveCount(0);
    await courierPage.getByRole('button',{name:'Принять заказ',exact:true}).click();
    await courierPage.getByText('Текст открытки',{exact:true}).click();await expect(courierPage.getByText(order.cardText,{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Назад',exact:true}).click();await nav(page,'Профиль');await page.getByRole('button',{name:'Мой магазин',exact:true}).click();
    await page.getByRole('button',{name:'Изменить данные',exact:true}).click();await page.getByLabel('Название магазина',{exact:true}).fill('Новое название магазина');await page.getByRole('button',{name:'Сохранить магазин',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Новое название магазина',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Удалить профиль магазина',exact:true}).click();await page.getByRole('button',{name:'Удалить профиль',exact:true}).click();
    await expect(page.getByRole('button',{name:'Добавить магазин',exact:true})).toBeVisible();
    const ownHeaders={Authorization:`Bearer ${customer.sessionToken}`};expect((await (await request.get(`/api/orders/${order.id}`,{headers:ownHeaders})).json()).order.businessName).toBe(shopName);
    for(const status of ['PICKED_UP','IN_TRANSIT','DELIVERED'])expect((await request.post(`/api/orders/${order.id}/status`,{headers:{Origin:origin,Authorization:`Bearer ${courier.sessionToken}`},data:{status}})).status()).toBe(200);
    await page.getByRole('button',{name:'Назад',exact:true}).click();await nav(page,'Заказы');await page.getByRole('button',{name:'Завершённые',exact:true}).click();
    await page.getByRole('button',{name:'Повторить заказ',exact:true}).click();
    await expect(page.getByLabel('Имя получателя',{exact:true})).toHaveValue('Получатель цветов');
    await expect(page.getByRole('button',{name:'Как можно скорее',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.getByRole('checkbox',{name:'Добавить текст открытки',exact:true})).not.toBeChecked();
    await expect(page.getByRole('checkbox',{name:/^Важно доставить без задержки/})).not.toBeChecked();
    await expect(page.getByLabel('Текст открытки',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Проверить заказ',exact:true}).click();
    const repeated=page.waitForResponse(r=>r.url().endsWith('/api/orders')&&r.request().method()==='POST');await page.getByRole('button',{name:'Подтвердить заказ',exact:true}).click();
    const repeatedResponse=await repeated;expect(repeatedResponse.status()).toBe(201);const second=(await repeatedResponse.json()).order;
    expect(second.id).not.toBe(order.id);expect(second.businessName).toBeNull();expect(second.deliverAfter).toBeNull();expect(second.cardText).toBeNull();expect(second.pricing).toBeNull();
    await page.reload();await nav(page,'Заказы');await expect(page.getByRole('main')).toContainText(shopName);
    expect(errors).toEqual([]);
  }finally{
    for(const context of contexts)await context.close();
    const ids=[customer.user.id,courier.user.id,other.user.id];
    await db.query('DELETE FROM qadam.orders WHERE customer_id=ANY($1::uuid[])',[ids]);await db.query('DELETE FROM qadam.courier_applications WHERE user_id=ANY($1::uuid[])',[ids]);await db.query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])',[ids]);
    await db.end();await closeDatabase();
  }
});

test('shop profile errors preserve personal delivery and a surprise requires the sender contact without losing its draft',async({page,request})=>{
  test.setTimeout(60000);
  const person=await account(request,'Ошибка профиля магазина');await mockMapTiles(page.context());
  await miniApp(page,person.proof);let failing=true;await page.route('**/api/business-profile',route=>failing?route.fulfill({status:503,json:{error:'Не удалось загрузить магазин'}}):route.continue());
  await expect(page.getByRole('heading',{name:'Куда доставить?',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Указать адреса',exact:true})).toBeEnabled();
  await nav(page,'Профиль');await page.getByRole('button',{name:'Мой магазин',exact:true}).click();await expect(page.getByRole('main').getByRole('alert')).toContainText('Не удалось загрузить магазин');
  failing=false;await page.getByRole('button',{name:'Повторить загрузку',exact:true}).click();await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);await expect(page.getByRole('button',{name:'Добавить магазин',exact:true})).toBeEnabled();
  await maps(page.context(),page);let creations=0;page.on('request',r=>{if(r.url().endsWith('/api/orders')&&r.method()==='POST')creations++;});
  await page.getByRole('button',{name:'Назад',exact:true}).click();await nav(page,'Доставка');
  await page.getByRole('button',{name:'Указать адреса',exact:true}).click();await address(page,'Адрес отправления','Абая, 100');await address(page,'Адрес доставки','Самал-2, 111');
  await page.getByRole('button',{name:'Далее — получатель',exact:true}).click();
  await page.getByLabel('Имя получателя',{exact:true}).fill('Получатель сюрприза');await page.getByLabel('Телефон получателя',{exact:true}).fill('+77000000011');
  await page.getByRole('checkbox',{name:/^Сюрприз для получателя/}).check();await page.getByRole('button',{name:'Проверить заказ',exact:true}).click();
  await page.getByRole('button',{name:'Подтвердить телефон',exact:true}).click();await expect(page.getByRole('heading',{name:'Телефон для связи',exact:true})).toBeVisible();expect(creations).toBe(0);
  await page.getByRole('button',{name:'Назад',exact:true}).click();await expect(page.getByRole('heading',{name:'Всё верно?',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Назад',exact:true}).click();await expect(page.getByLabel('Имя получателя',{exact:true})).toHaveValue('Получатель сюрприза');await expect(page.getByRole('checkbox',{name:/^Сюрприз для получателя/})).toBeChecked();
});
