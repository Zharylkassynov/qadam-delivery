import {test,expect,type BrowserContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {signedTelegramData} from '../telegram-fixture';
import {miniApp} from './telegram-browser-fixture';
import {mockMapTiles} from './map-fixture';
import {readyCourier} from '../courier-ready-fixture';
import {closeDatabase} from '../../src/lib/db';
import {recipientConsentText} from '../../src/lib/recipient-tracking-types';
import type {User} from '../../src/lib/types';

test.skip(Boolean(process.env.E2E_ORIGIN),'Local synthetic recipients only');
const origin='http://127.0.0.1:3100';
test('owner shares a private link, courier explicitly allows recipient GPS, anonymous recipient follows delivery and revocation',async({browser,request},info)=>{
  test.setTimeout(150000);
  const url=process.env.TEST_DATABASE_URL;
  if(!url||!new URL(url).pathname.endsWith('_test')||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('Local _test database required');
  process.env.DATABASE_URL=url;
  const db=new pg.Client({connectionString:url});await db.connect();
  const contexts:BrowserContext[]=[],ids:string[]=[],telegramIds:number[]=[],errors:string[]=[];
  async function account(name:string){const tid=5900000000000+Math.floor(Math.random()*1000000000);telegramIds.push(tid);const proof=signedTelegramData({id:tid,first_name:name});const r=await request.post('/api/auth/telegram',{headers:{Origin:origin},data:{initData:proof}});expect(r.status()).toBe(200);const a=await r.json() as {user:User;sessionToken:string};ids.push(a.user.id);return{...a,proof};}
  const headers=(token:string)=>({Origin:origin,Authorization:`Bearer ${token}`});
  try{
    await db.query('UPDATE qadam.pricing_settings SET active=false');
    await db.query("DELETE FROM qadam.service_limits WHERE bucket LIKE 'recipient%'");
    const owner=await account('Отправитель ссылки'),courier=await account('Арман Проверка');
    await db.query("INSERT INTO qadam.courier_applications(user_id,phone,transport,status,reviewed_at,reviewed_by) VALUES($1,'+77000000888','CAR','APPROVED',now(),$2)",[courier.user.id,owner.user.id]);
    const created=await request.post('/api/orders',{headers:headers(owner.sessionToken),data:{requestKey:randomUUID(),pickupAddress:'Скрытый адрес отправителя 99',destinationAddress:'Скрытый адрес получателя 88',recipientName:'Закрытый получатель ссылки',recipientPhone:'+77000000999',notes:'Закрытое примечание'}});expect(created.status()).toBe(201);const order=(await created.json()).order;
    const context=await browser.newContext({viewport:{width:390,height:844},permissions:['clipboard-read','clipboard-write']});contexts.push(context);await mockMapTiles(context);
    const sender=await context.newPage();sender.on('pageerror',e=>errors.push(e.message));await miniApp(sender,owner.proof,760,origin,{query:`order=${order.id}`});
    await sender.getByRole('button',{name:'Создать ссылку',exact:true}).click();
    await sender.getByText('Настройки ссылки',{exact:true}).click();
    const input=sender.getByRole('textbox',{name:'Ссылка для получателя',exact:true});await expect(input).toHaveValue(/\/t\/[\w-]{43}$/);const shareUrl=await input.inputValue(),token=shareUrl.split('/').at(-1)!;
    const whatsapp=new URL((await sender.getByRole('link',{name:'Отправить в WhatsApp',exact:true}).getAttribute('href'))!);
    expect(whatsapp.origin).toBe('https://wa.me');expect(whatsapp.pathname).toBe('/77000000999');expect(whatsapp.searchParams.get('text')).toContain(shareUrl);
    await sender.getByRole('heading',{name:'Отслеживание для получателя',exact:true}).scrollIntoViewIfNeeded();await sender.screenshot({path:info.outputPath('sender-sharing-390.png'),fullPage:true});
    await sender.getByRole('button',{name:'Скопировать ссылку',exact:true}).click();await expect(sender.getByRole('status').filter({hasText:'Ссылка скопирована.'})).toBeVisible();
    const recipientContext=await browser.newContext({viewport:{width:390,height:844}});contexts.push(recipientContext);
    const recipient=await recipientContext.newPage();recipient.on('pageerror',e=>errors.push(e.message));const sdk:string[]=[];recipient.on('request',r=>{if(r.url().includes('telegram.org'))sdk.push(r.url());});
    const first=await recipient.goto(shareUrl);expect(first!.headers()['referrer-policy']).toBe('no-referrer');expect(first!.headers()['cache-control']).toContain('no-store');expect(first!.headers()['x-robots-tag']).toContain('noindex');
    const raw=await first!.text();for(const value of [order.id,owner.user.id,'Скрытый адрес','Закрытый получатель','Закрытое примечание','+77000000999'])expect(raw).not.toContain(value);
    expect(raw).not.toContain('telegram.org/js/');await expect(recipient.getByText('Ищем курьера',{exact:true}).first()).toBeVisible();expect(sdk).toEqual([]);
    await readyCourier(courier.user);
    expect((await request.post(`/api/orders/${order.id}/accept`,{headers:headers(courier.sessionToken),data:{}})).status()).toBe(200);
    const courierPage=await context.newPage();courierPage.on('pageerror',e=>errors.push(e.message));await miniApp(courierPage,courier.proof,760,origin,{query:`order=${order.id}`});
    // The deep link briefly passes through the courier home while the order
    // loads. Open settings only in the requested order, not that initial home.
    const courierDetail=courierPage.getByRole('region',{name:'Детали заказа',exact:true});
    await expect(courierDetail.getByRole('heading',{name:'Заберите посылку',exact:true})).toBeVisible();
    await courierDetail.getByRole('button',{name:'Настройки геолокации',exact:true}).click();
    const consent=courierPage.getByRole('checkbox',{name:recipientConsentText,exact:true});await expect(consent).not.toBeChecked();
    const allow=courierPage.getByRole('button',{name:'Разрешить показ получателю',exact:true});await expect(allow).toBeDisabled();await consent.focus();await expect(consent).toBeFocused();await courierPage.keyboard.press('Space');await expect(consent).toBeChecked();await courierPage.screenshot({path:info.outputPath('courier-consent-390.png'),fullPage:true});await allow.click();await expect(courierPage.getByText('Показ получателю разрешён',{exact:true})).toBeVisible();
    expect((await request.post(`/api/orders/${order.id}/status`,{headers:headers(courier.sessionToken),data:{status:'PICKED_UP'}})).status()).toBe(200);
    await db.query('UPDATE qadam.courier_locations SET captured_at=now(),received_at=now() WHERE order_id=$1',[order.id]);
    // Real status/GPS API and database; only provider availability/tiles are synthetic.
    await recipient.route('**/api/recipient-tracking',async route=>{const response=await route.fetch();if(response.ok()){const body=await response.json();body.delivery.mapAvailable=true;await route.fulfill({response,json:body});}else await route.fulfill({response});});
    const tile='<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#edf1eb"/><path d="M0 60H256M0 180H256M90 0V256M210 0V256" stroke="white" stroke-width="12"/><text x="14" y="30" font-size="12" fill="#526779">Карта для автопроверки</text></svg>';
    await recipient.route('**/api/recipient-tiles/**',async route=>{expect((await route.request().allHeaders())['x-qadam-tracking']).toBe(token);expect(route.request().url()).not.toContain(token);await route.fulfill({contentType:'image/svg+xml',body:tile});});
    await recipient.reload();await expect(recipient.getByRole('heading',{name:'Курьер: Арман',exact:true})).toBeVisible();await expect(recipient.locator('.qadam-map-marker.courier')).toHaveCount(1);
    for(const width of [320,390,768,1280]){await recipient.setViewportSize({width,height:950});expect(await recipient.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);if(width===390||width===1280)await recipient.screenshot({path:info.outputPath(`recipient-${width}.png`),fullPage:true});}
    await db.query("UPDATE qadam.courier_locations SET captured_at=now()-interval '91 seconds' WHERE order_id=$1",[order.id]);await recipient.reload();await expect(recipient.getByText('Нет свежей позиции',{exact:true})).toBeVisible();await expect(recipient.locator('.recipient-map')).toHaveCount(0);
    await recipient.screenshot({path:info.outputPath('recipient-stale.png'),fullPage:true});
    await db.query('UPDATE qadam.courier_locations SET captured_at=now(),received_at=now() WHERE order_id=$1',[order.id]);await recipient.reload();await expect(recipient.locator('.qadam-map-marker.courier')).toHaveCount(1);
    await recipient.route('**/api/recipient-tracking',route=>route.abort('failed'));await recipient.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await expect(recipient.getByRole('alert').filter({hasText:'Не удалось обновить доставку'})).toBeVisible();await expect(recipient.locator('.recipient-map')).toHaveCount(0);await expect(recipient.getByText(/Последняя успешная проверка:/)).toBeVisible();await recipient.unroute('**/api/recipient-tracking');await recipient.getByRole('button',{name:'Повторить',exact:true}).click();await expect(recipient.getByRole('heading',{name:'Курьер: Арман',exact:true})).toBeVisible();
    await courierPage.getByRole('button',{name:'Остановить показ получателю',exact:true}).click();await expect(courierPage.getByRole('button',{name:'Разрешить показ получателю',exact:true})).toBeDisabled();await recipient.reload();await expect(recipient.getByRole('heading',{name:'Курьер: Арман',exact:true})).toHaveCount(0);await expect(recipient.getByText('Позиция пока недоступна',{exact:true})).toBeVisible();
    await request.post(`/api/orders/${order.id}/status`,{headers:headers(courier.sessionToken),data:{status:'IN_TRANSIT'}});await request.post(`/api/orders/${order.id}/status`,{headers:headers(courier.sessionToken),data:{status:'DELIVERED'}});await recipient.reload();await expect(recipient.getByText('Доставка завершена',{exact:true})).toBeVisible();await expect(recipient.locator('.recipient-map')).toHaveCount(0);
    await expect(sender.locator('details').filter({has:sender.getByText('Настройки ссылки',{exact:true})})).toHaveAttribute('open','');
    await sender.getByRole('button',{name:'Отключить ссылку',exact:true}).click();await sender.getByRole('dialog',{name:'Подтверждение действия'}).getByRole('button',{name:'Подтвердить',exact:true}).click();await expect(sender.getByRole('button',{name:'Создать ссылку',exact:true})).toBeVisible();await recipient.reload();await expect(recipient.getByRole('heading',{name:'Ссылка недоступна',exact:true})).toBeVisible();
    expect(errors).toEqual([]);
  }finally{
    for(const c of contexts)await c.close();
    await db.query('DELETE FROM qadam.orders WHERE customer_id=ANY($1::uuid[])',[ids]);await db.query('DELETE FROM qadam.telegram_outbox WHERE telegram_user_id=ANY($1::bigint[])',[telegramIds]);await db.query('DELETE FROM qadam.courier_applications WHERE user_id=ANY($1::uuid[])',[ids]);await db.query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])',[ids]);await db.end();await closeDatabase();
  }
});
