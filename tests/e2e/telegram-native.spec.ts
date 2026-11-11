import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {miniApp} from './telegram-browser-fixture';
import {signedTelegramData} from '../telegram-fixture';
import {mockMapTiles} from './map-fixture';
import {database,closeDatabase} from '../../src/lib/db';
import {saveLocationSettings} from '../../src/lib/courier-location-settings';
import {setCourierStatus} from '../../src/lib/courier-status';
import {updateCourierPresence} from '../../src/lib/courier-presence';
import {locationConsentVersion} from '../../src/lib/location-consent';
import type {User} from '../../src/lib/types';

const origin='http://127.0.0.1:3100';
test.use({viewport:{width:390,height:844}});
test.skip(Boolean(process.env.E2E_ORIGIN),'Synthetic local Telegram SDK only');
test.beforeAll(()=>{const url=process.env.TEST_DATABASE_URL;if(!url||!new URL(url).pathname.endsWith('_test')||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('Separate local _test database required');process.env.DATABASE_URL=url;});
test.afterAll(closeDatabase);
async function account(request:APIRequestContext,name:string){
  const proof=signedTelegramData({id:8800000000000+Math.floor(Math.random()*1e9),first_name:name});
  const response=await request.post('/api/auth/telegram',{headers:{Origin:origin},data:{initData:proof}});expect(response.status()).toBe(200);
  return {...await response.json() as {user:User;sessionToken:string},proof};
}
const headers=(token:string)=>({Origin:origin,Authorization:`Bearer ${token}`});
const input=()=>({requestKey:randomUUID(),pickupAddress:`Алматы, Native ${randomUUID().slice(0,6)}, Абая 10`,destinationAddress:'Алматы, Сатпаева 30',recipientName:'Получатель кнопок',recipientPhone:'+77000000000',notes:''});
const main=(page:Page)=>page.evaluate(()=>window.__qadamTelegram!.main);
const press=(page:Page)=>page.evaluate(()=>window.__qadamTelegram!.pressMain());
const nav=(page:Page,name:string)=>page.getByRole('navigation',{name:'Мобильная навигация'}).getByRole('button',{name,exact:true}).click();

test('native controls validate forms, retain drafts across themes and prevent duplicate creates; confirm and polling stay separate',async({page,request,context},info)=>{
  test.setTimeout(90000);await mockMapTiles(context);
  const customer=await account(request,'Нативный клиент');
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let creates=0;
  let orderId:string|undefined;
  try{
    await miniApp(page,customer.proof,760,'',{native:{}});
    await page.route('**/api/orders',async route=>{if(route.request().method()==='POST'){creates++;await gate;}await route.continue();});
    await expect(page.getByRole('heading',{name:'Куда доставить?',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Указать адреса',exact:true}).click();
    await expect.poll(async()=>await main(page)).toMatchObject({text:'Выбрать адрес',visible:true,active:false});
    await expect(page.getByRole('button',{name:'Выбрать адрес',exact:true})).toHaveCount(0);
    await page.getByLabel('Адрес отправления',{exact:true}).fill('Алматы, Абая 10');
    await expect.poll(async()=>(await main(page)).active).toBe(true);await press(page);
    await expect(page.getByLabel('Адрес доставки',{exact:true})).toBeVisible();
    await page.getByLabel('Адрес доставки',{exact:true}).fill('Алматы, Сатпаева 30');await press(page);
    await page.getByRole('button',{name:'Далее — получатель',exact:true}).click();
    await expect.poll(async()=>(await main(page)).text).toBe('Проверить заказ');
    await press(page);await expect(page.getByLabel('Имя получателя',{exact:true})).toBeVisible();
    await page.getByLabel('Имя получателя',{exact:true}).fill('Получатель темы');await page.getByLabel('Телефон получателя',{exact:true}).fill('+77000000000');
    await page.evaluate(()=>window.__qadamTelegram!.changeTheme(true));
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme','dark');
    await expect.poll(async()=>await main(page)).toMatchObject({color:'#2b6cbb',textColor:'#ffffff'});
    await expect(page.getByLabel('Имя получателя',{exact:true})).toHaveValue('Получатель темы');
    for(const width of [320,390,768,1280]){
      await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const title=await page.locator('.app-bar > p').boundingBox(),bar=await page.locator('.app-bar').boundingBox();
      expect(title!.width).toBeGreaterThan(bar!.width/2);expect(title!.height).toBeLessThanOrEqual(48);
    }
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath('telegram-dark-form.png')});
    await page.evaluate(()=>window.__qadamTelegram!.changeTheme(false));await press(page);
    await expect(page.getByRole('heading',{name:'Всё верно?',exact:true})).toBeVisible();
    await expect.poll(async()=>await main(page)).toMatchObject({text:'Подтвердить заказ',active:true});
    const created=page.waitForResponse(r=>r.url().endsWith('/api/orders')&&r.request().method()==='POST');
    await page.evaluate(()=>{window.__qadamTelegram!.pressMain();window.__qadamTelegram!.pressMain();});
    await expect.poll(async()=>await main(page)).toMatchObject({active:false,progress:true});expect(creates).toBe(1);
    release();const response=await created;expect(response.status()).toBe(201);orderId=(await response.json()).order.id;
    await expect(page.getByRole('button',{name:'Отменить заказ',exact:true})).toBeVisible();
    await expect.poll(async()=>(await main(page)).visible).toBe(false);
    const haptics=await page.evaluate(()=>window.__qadamTelegram!.haptics.filter(x=>x==='success').length);expect(haptics).toBe(1);
    const refreshed=page.waitForResponse(r=>r.url().endsWith('/api/orders')&&r.request().method()==='GET');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await refreshed;
    expect(await page.evaluate(()=>window.__qadamTelegram!.haptics.filter(x=>x==='success').length)).toBe(haptics);
    await page.getByRole('button',{name:'Отменить заказ',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>window.__qadamTelegram!.confirmations.length)).toBe(1);
    expect((await (await request.get(`/api/orders/${orderId}`,{headers:headers(customer.sessionToken)})).json()).order.status).toBe('SEARCHING_FOR_COURIER');
    await page.evaluate(()=>window.__qadamTelegram!.answerConfirm(false));
    await page.getByRole('button',{name:'Отменить заказ',exact:true}).click();
    const cancelled=page.waitForResponse(r=>r.url().endsWith(`/api/orders/${orderId}/status`)&&r.request().method()==='POST');
    await page.evaluate(()=>window.__qadamTelegram!.answerConfirm(true));expect((await cancelled).status()).toBe(200);
    await expect.poll(async()=>(await main(page)).text).toBe('Повторить заказ');
    expect(await page.evaluate(()=>({main:window.__qadamTelegram!.mainListeners,back:window.__qadamTelegram!.backListeners}))).toEqual({main:1,back:1});
    await page.evaluate(()=>window.__qadamTelegram!.pressBack());await nav(page,'Профиль');
    await expect.poll(()=>page.evaluate(()=>window.__qadamTelegram!.backVisible)).toBe(false);
  }finally{release();if(orderId)await request.post(`/api/orders/${orderId}/status`,{headers:headers(customer.sessionToken),data:{status:'CANCELLED'}});}
});

test('old Telegram keeps browser controls and uses an accessible confirmation without SDK popup support',async({page,request,context},info)=>{
  await mockMapTiles(context);const customer=await account(request,'Старый Telegram');
  const created=await request.post('/api/orders',{headers:headers(customer.sessionToken),data:input()});expect(created.status()).toBe(201);const order=(await created.json()).order;
  try{
    await miniApp(page,customer.proof,760,'',{query:`order=${order.id}`,native:{version:'5.0',confirm:false}});
    await expect(page.getByRole('button',{name:'Отменить заказ',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Назад',exact:true})).toBeVisible();expect((await main(page)).visible).toBe(false);
    await page.getByRole('button',{name:'Отменить заказ',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Подтверждение действия',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await (await request.get(`/api/orders/${order.id}`,{headers:headers(customer.sessionToken)})).json()).order.status).toBe('SEARCHING_FOR_COURIER');
    await page.evaluate(()=>Object.defineProperty(HTMLDialogElement.prototype,'showModal',{value:undefined,configurable:true}));
    await page.getByRole('button',{name:'Отменить заказ',exact:true}).click();await expect(page.getByRole('alertdialog',{name:'Подтверждение действия'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Отмена',exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Подтвердить',exact:true})).toBeFocused();
    await page.screenshot({path:info.outputPath('old-telegram-confirm.png')});
    const cancelled=page.waitForResponse(r=>r.url().endsWith(`/api/orders/${order.id}/status`)&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Подтвердить',exact:true}).click();expect((await cancelled).status()).toBe(200);
    await expect(page.getByRole('button',{name:'Повторить заказ',exact:true})).toBeVisible();expect(await page.evaluate(()=>window.__qadamTelegram!.haptics)).toEqual([]);
  }finally{await request.post(`/api/orders/${order.id}/status`,{headers:headers(customer.sessionToken),data:{status:'CANCELLED'}});}
});

test('courier selects short or all jobs, navigates to the correct party and adds a shortcut only on client confirmation',async({page,request,context},info)=>{
  test.setTimeout(90000);await mockMapTiles(context);
  const customer=await account(request,'Клиент навигации'),courier=await account(request,'Курьер навигации');const actor={...courier.user,role:'COURIER' as const};
  const ids:string[]=[];
  try{
    await database().query("INSERT INTO qadam.courier_applications(user_id,phone,transport,status,reviewed_at,reviewed_by) VALUES($1,'+77000000000','FOOT','APPROVED',now(),$2)",[actor.id,customer.user.id]);
    await saveLocationSettings(actor,{autoEnabled:true,consentVersion:locationConsentVersion});await setCourierStatus(actor,{online:true});await updateCourierPresence(actor,{latitude:43.24,longitude:76.9,accuracy:20,capturedAt:new Date().toISOString()});
    for(const destination of [43.25,43.29]){
      const response=await request.post('/api/orders',{headers:headers(customer.sessionToken),data:{...input(),pickupPoint:{latitude:43.241,longitude:76.9},destinationPoint:{latitude:destination,longitude:76.9}}});expect(response.status()).toBe(201);ids.push((await response.json()).order.id);
    }
    await miniApp(page,courier.proof,760,'',{native:{shortcut:'unknown'}});
    await expect(page.getByRole('button',{name:'До 4 км',exact:true})).toHaveAttribute('aria-pressed','true');
    const short=await (await request.get(`/api/orders/${ids[0]}`,{headers:headers(customer.sessionToken)})).json();const long=await (await request.get(`/api/orders/${ids[1]}`,{headers:headers(customer.sessionToken)})).json();
    await expect(page.getByRole('button',{name:`Открыть заказ QD-${short.order.number.padStart(4,'0')}`,exact:true})).toHaveCount(1);
    await expect(page.getByRole('button',{name:`Открыть заказ QD-${long.order.number.padStart(4,'0')}`,exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Все',exact:true}).click();
    expect(await page.evaluate(()=>window.__qadamTelegram!.haptics.includes('selection'))).toBe(true);
    await expect(page.getByRole('button',{name:`Открыть заказ QD-${long.order.number.padStart(4,'0')}`,exact:true})).toHaveCount(1);
    await page.getByRole('button',{name:`Открыть заказ QD-${short.order.number.padStart(4,'0')}`,exact:true}).click();
    await expect.poll(async()=>await main(page)).toMatchObject({text:'Принять заказ',active:true,visible:true});
    let acceptanceAttempts=0;
    await page.route(`**/api/orders/${ids[0]}/accept`,route=>++acceptanceAttempts===1?route.fulfill({status:503,json:{error:'Синтетический отказ принятия'}}):route.continue());
    await press(page);await expect(page.getByRole('main').getByRole('alert').filter({hasText:'Синтетический отказ принятия'})).toBeVisible();
    await expect.poll(async()=>await main(page)).toMatchObject({text:'Принять заказ',active:true,progress:false});
    expect(await page.evaluate(()=>window.__qadamTelegram!.haptics.filter(x=>x==='error').length)).toBe(1);await press(page);
    await expect.poll(async()=>(await main(page)).text).toBe('Посылка у меня');
    await page.getByText('Открыть навигацию',{exact:true}).click();await expect(page.getByText('До отправителя',{exact:true})).toBeVisible();
    const google=page.getByRole('link',{name:'Google Maps',exact:true});await google.click();
    expect(await page.evaluate(()=>new URL(window.__qadamTelegram!.links.at(-1)!).searchParams.get('destination'))).toBe('43.241,76.9');
    await press(page);await expect(page.getByText('До получателя',{exact:true})).toBeVisible();
    await google.click();expect(await page.evaluate(()=>new URL(window.__qadamTelegram!.links.at(-1)!).searchParams.get('destination'))).toBe('43.25,76.9');
    await page.screenshot({path:info.outputPath('courier-navigation-native.png')});
    await press(page);await expect.poll(async()=>(await main(page)).text).toBe('Завершить доставку');await press(page);
    await expect.poll(async()=>(await main(page)).text).toBe('В историю заказов');await page.evaluate(()=>window.__qadamTelegram!.pressBack());
    await nav(page,'Профиль');await page.getByRole('button',{name:'Добавить на главный экран',exact:true}).click();
    await expect(page.getByText('Следуйте подсказкам Telegram.',{exact:true})).toBeVisible();await expect(page.getByText('Ярлык уже добавлен',{exact:true})).toHaveCount(0);
    expect(await page.evaluate(()=>window.__qadamTelegram!.shortcutRequests)).toBe(1);await page.evaluate(()=>window.__qadamTelegram!.shortcutAdded());
    await expect(page.getByText('Ярлык уже добавлен',{exact:true})).toBeVisible();
    const older=await context.newPage();await miniApp(older,courier.proof,760,'',{native:{version:'5.0'}});await nav(older,'Профиль');
    await expect(older.getByRole('button',{name:'Добавить на главный экран',exact:true})).toHaveCount(0);await older.close();
    const unsupported=await context.newPage();await miniApp(unsupported,courier.proof,760,'',{native:{shortcut:'unsupported'}});await nav(unsupported,'Профиль');
    await expect(unsupported.getByRole('button',{name:'Добавить на главный экран',exact:true})).toHaveCount(0);expect(await unsupported.evaluate(()=>window.__qadamTelegram!.shortcutRequests)).toBe(0);await unsupported.close();
  }finally{
    await database().query("UPDATE qadam.orders SET status='CANCELLED' WHERE id=ANY($1::uuid[]) AND status<>'DELIVERED'",[ids]);
    await database().query('DELETE FROM qadam.orders WHERE customer_id=$1',[customer.user.id]);await database().query('DELETE FROM qadam.courier_applications WHERE user_id=$1',[actor.id]);
  }
});
