import { test,expect,type APIRequestContext,type BrowserContext,type Page } from '@playwright/test';
import pg from 'pg';
import { signedTelegramData } from '../telegram-fixture';
import { miniApp } from './telegram-browser-fixture';
import { mockMapTiles } from './map-fixture';
import { expectPhoneCall } from './phone-link-fixture';
import { createQuote } from '../../src/lib/order-quotes';
import { closeDatabase } from '../../src/lib/db';
import { saveTelegramContact } from '../../src/lib/user-profiles';
import type { Tariff } from '../../src/lib/pricing';
import { deliveryPilot } from '../../src/lib/delivery-pilot';

test.skip(Boolean(process.env.E2E_ORIGIN),'Synthetic local pricing only');
test.use({viewport:{width:390,height:844}});
const origin='http://127.0.0.1:3100';
const tariff:Tariff={version:'e2e-only-car',minimumKzt:1200,baseKzt:800,perKmKzt:70,perMinuteKzt:12,roundToKzt:50,ttlSeconds:120,provider:'TOMTOM_V1',zone:{...deliveryPilot.zone}};
const a={id:'test-a',address:'Жибек Жолы, 53',detail:'Алматы',precision:'building',latitude:43.263,longitude:76.953};
const b={...a,id:'test-b',address:'Самал-2, 111',latitude:43.234,longitude:76.957};

async function account(request:APIRequestContext,name:string){
  const telegramId=4600000000000+Math.floor(Math.random()*1000000000);
  const proof=signedTelegramData({id:telegramId,first_name:name});
  const response=await request.post('/api/auth/telegram',{headers:{Origin:origin},data:{initData:proof}});
  expect(response.status()).toBe(200);return {...await response.json(),proof,telegramId};
}
async function maps(context:BrowserContext,page:Page){
  await mockMapTiles(context);
  await page.route('**/api/orders/*/route',route=>route.fulfill({json:{route:{mode:'drive',distanceMeters:4592,paths:[[[a.latitude,a.longitude],[b.latitude,b.longitude]]]}}}));
  await page.route('**/api/geocoding',route=>route.fulfill({json:{results:[route.request().postDataJSON().query.includes('Самал')?b:a]}}));
}
async function address(page:Page,label:string,value:string){
  await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByRole('button',{name:'Найти адрес',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Найденный адрес',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Выбрать адрес',exact:true}).click();
}

test('fixed price survives expiry, own phone verification, assignment and reopening; contacts stay private',async({browser,request},info)=>{
  test.setTimeout(90000);
  const testUrl=process.env.TEST_DATABASE_URL;
  if(!testUrl||!new URL(testUrl).pathname.endsWith('_test')||!['localhost','127.0.0.1'].includes(new URL(testUrl).hostname))throw new Error('Local isolated _test database required');
  process.env.DATABASE_URL=testUrl;
  const db=new pg.Client({connectionString:testUrl});await db.connect();
  const customer=await account(request,'Клиент цены'),courier=await account(request,'Автокурьер цены');
  const contexts:BrowserContext[]=[];
  const pageErrors:string[]=[];
  let quoteCount=0;
  try{
    await db.query('UPDATE qadam.pricing_settings SET active=true,config=$1',[JSON.stringify(tariff)]);
    await db.query('DELETE FROM qadam.service_limits');
    await db.query(`INSERT INTO qadam.courier_applications(user_id,phone,transport,status,reviewed_at,reviewed_by)
      VALUES($1,'+77000000033','CAR','APPROVED',now(),$2)`,[courier.user.id,customer.user.id]);
    await saveTelegramContact(String(courier.telegramId),'+77000000033',Date.now());
    const customerContext=await browser.newContext({viewport:{width:390,height:844}});contexts.push(customerContext);
    const page=await customerContext.newPage();page.on('pageerror',e=>pageErrors.push(e.message));
    await miniApp(page,customer.proof,760,'',{contact:'allow'});
    await maps(customerContext,page);
    // Only the external road is simulated. Quote ownership/SQL and order APIs are real.
    await page.route('**/api/orders/quote',async route=>{
      if(route.request().method()!=='POST')return route.continue();
      const input=route.request().postDataJSON();
      if(input.payer!=='RECIPIENT'||input.paymentMethod!=='CASH')return route.fulfill({status:503,json:{error:'Синтетический расчёт после выбора оплаты.'}});
      quoteCount++;
      const quote=await createQuote(customer.user,input,async()=>({distanceM:4592,durationS:quoteCount===1?1163:1763,provider:'TOMTOM_V1',measuredAt:new Date(),paths:[]}));
      if(quoteCount===1){quote.expiresAt=new Date(Date.now()+1800).toISOString();await db.query('UPDATE qadam.order_quotes SET expires_at=$2 WHERE id=$1',[quote.id,quote.expiresAt]);}
      await route.fulfill({status:201,json:{quote}});
    });
    await page.getByRole('button',{name:'Указать адреса',exact:true}).click();
    await address(page,'Адрес отправления','Жибек Жолы, 53');await address(page,'Адрес доставки','Самал-2, 111');
    await page.getByRole('button',{name:'Далее — получатель',exact:true}).click();
    await page.getByLabel('Имя получателя',{exact:true}).fill('Получатель цены');
    await page.getByLabel('Телефон получателя',{exact:true}).fill('+77000000011');
    await page.getByRole('button',{name:'Проверить заказ',exact:true}).click();
    const parcelConfirmation=page.getByRole('checkbox',{name:deliveryPilot.parcelStatement,exact:true});
    await expect(parcelConfirmation).not.toBeChecked();
    await expect(page.getByRole('button',{name:'Подтвердить телефон',exact:true})).toBeDisabled();
    expect(quoteCount).toBe(0);
    for(const width of [320,390]){
      await page.setViewportSize({width,height:844});
      await page.getByRole('heading',{name:'Условия посылки',exact:true}).scrollIntoViewIfNeeded();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
      await page.screenshot({path:info.outputPath(`pilot-parcel-${width}.png`)});
    }
    await page.getByRole('radio',{name:'Получатель',exact:true}).check();
    await page.getByRole('radio',{name:/Наличные/}).check();
    await parcelConfirmation.check();
    await expect(page.getByText('Цена больше не действует',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Подтвердить телефон',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'Обновить цену',exact:true}).click();
    await expect(page.getByText('Стоимость изменилась',{exact:true})).toBeVisible();
    await page.locator('.quote-price').scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath('price-review-390.png')});
    await page.getByRole('button',{name:'Подтвердить телефон',exact:true}).click();
    await expect(page.locator('.app-bar p')).toHaveText('Телефон для связи');
    await page.getByRole('button',{name:'Поделиться номером',exact:true}).click();
    await expect(page.locator('html')).toHaveAttribute('data-contact-requested','true');
    await expect(page.getByText('Номер получен из Telegram',{exact:true})).toHaveCount(0);
    // A trusted server contact arrives after the SDK boolean; it is not inferred from it.
    await saveTelegramContact(String(customer.telegramId),'+77000000022',Date.now()+1);
    await expect(page.getByText('Номер получен из Telegram',{exact:true})).toBeVisible();
    await page.screenshot({path:info.outputPath('phone-verified-390.png')});
    await page.getByRole('button',{name:'Вернуться к заказу',exact:true}).click();
    const created=page.waitForResponse(r=>r.url().endsWith('/api/orders')&&r.request().method()==='POST');
    await page.getByRole('button',{name:/Создать заказ за 1\s?500/}).click();
    const response=await created;expect(response.status()).toBe(201);const {order}=await response.json();
    expect(order.pricing.priceKzt).toBe(1500);expect(order.payer).toBe('RECIPIENT');expect(order.paymentMethod).toBe('CASH');
    expect(order.pricing.breakdown.pilotTermsVersion).toBe(deliveryPilot.termsVersion);
    const unavailable=await request.get(`/api/orders/${order.id}`,{headers:{Authorization:`Bearer ${courier.sessionToken}`}});
    expect(unavailable.status()).toBe(200);expect((await unavailable.json()).order.senderPhone).toBeNull();
    const courierContext=await browser.newContext({viewport:{width:360,height:800}});contexts.push(courierContext);
    const courierPage=await courierContext.newPage();courierPage.on('pageerror',e=>pageErrors.push(e.message));
    const phoneLoaded=courierPage.waitForResponse(r=>r.url().endsWith('/api/phone-profile')&&r.status()===200);
    await miniApp(courierPage,courier.proof,720);await maps(courierContext,courierPage);await phoneLoaded;
    const number=`QD-${order.number.padStart(4,'0')}`;
    await courierPage.getByRole('button',{name:`Открыть заказ ${number}`,exact:true}).click();
    await expect(courierPage.getByRole('link',{name:/Позвонить:/})).toHaveCount(0);
    await courierPage.getByRole('button',{name:/Принять · 1\s?500/}).click();
    await expect(courierPage.getByRole('link',{name:'Позвонить: +77000000022',exact:true})).toBeVisible();
    await expectPhoneCall(courierPage,courierPage.getByRole('link',{name:'Позвонить: +77000000022',exact:true}),'tel:+77000000022');
    await courierPage.locator('.quote-price').scrollIntoViewIfNeeded();
    await courierPage.screenshot({path:info.outputPath('priced-courier-360.png')});
    await db.query('UPDATE qadam.pricing_settings SET config=$1',[JSON.stringify({...tariff,baseKzt:9000})]);
    await page.goto(`/?order=${order.id}#tgWebAppVersion=8.0`);
    await expect(page.getByRole('link',{name:'Позвонить: +77000000033',exact:true})).toBeVisible();
    await expectPhoneCall(page,page.getByRole('link',{name:'Позвонить: +77000000033',exact:true}),'tel:+77000000033');
    await expect(page.locator('.quote-price-row')).toContainText(/1\s?500/);
    await page.locator('.quote-price').scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath('priced-customer-390.png')});
    expect(pageErrors).toEqual([]);
  }finally{
    for(const context of contexts)await context.close();
    await db.query('UPDATE qadam.pricing_settings SET active=false,config=NULL');
    await db.query('DELETE FROM qadam.orders WHERE customer_id=$1',[customer.user.id]);
    await db.query('DELETE FROM qadam.courier_applications WHERE user_id=$1',[courier.user.id]);
    await db.query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])',[[customer.user.id,courier.user.id]]);
    await db.end();await closeDatabase();
  }
});
