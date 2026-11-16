import {test,expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {database,closeDatabase} from '../../src/lib/db';
import {readyCourier} from '../courier-ready-fixture';
import {signedTelegramData} from '../telegram-fixture';
import {miniApp} from './telegram-browser-fixture';
import {mockMapTiles} from './map-fixture';
import type {User} from '../../src/lib/types';

const origin='http://127.0.0.1:3100';
test.skip(Boolean(process.env.E2E_ORIGIN),'Local synthetic identities only');
test.use({viewport:{width:390,height:844}});
test.beforeAll(()=>{
  const url=process.env.TEST_DATABASE_URL;
  if(!url||!['localhost','127.0.0.1'].includes(new URL(url).hostname)||!new URL(url).pathname.endsWith('_test'))throw new Error('Separate local test database required');
  process.env.DATABASE_URL=url;
});
test.afterAll(closeDatabase);
const headers=(token:string)=>({Origin:origin,Authorization:`Bearer ${token}`});
async function account(request:APIRequestContext,name:string){
  const proof=signedTelegramData({id:9500000000000+Math.floor(Math.random()*1e9),first_name:name});
  const r=await request.post('/api/auth/telegram',{headers:{Origin:origin},data:{initData:proof}});expect(r.status()).toBe(200);
  return{...await r.json() as {user:User;sessionToken:string},proof};
}

test('customer sees a concise searching and delivered order; details, rating and server history remain usable',async({page,request},info)=>{
  test.setTimeout(90000);await mockMapTiles(page.context());const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const customer=await account(request,'Краткий заказ — клиент'),courier=await account(request,'Краткий заказ — курьер'),ids=[customer.user.id,courier.user.id];
  try{
    courier.user.role='COURIER';await database().query("UPDATE qadam.users SET role='COURIER' WHERE id=$1",[courier.user.id]);
    await readyCourier(courier.user);
    const response=await request.post('/api/orders',{headers:headers(customer.sessionToken),data:{requestKey:randomUUID(),pickupAddress:'Алматы, Абая 10',destinationAddress:'Алматы, Сатпаева 30',pickupPoint:{latitude:43.24,longitude:76.9},destinationPoint:{latitude:43.25,longitude:76.91},recipientName:'Получатель краткого заказа',recipientPhone:'+77000000000',payer:'RECIPIENT',paymentMethod:'CASH',parcelType:'PARCEL',fragile:true,notes:'Позвонить у входа'}});
    expect(response.status()).toBe(201);const order=(await response.json()).order;
    await miniApp(page,customer.proof,844,'',{query:`order=${order.id}`,native:{}});
    const detail=page.getByRole('region',{name:'Детали заказа'});
    await expect(detail.getByRole('heading',{name:'Ищем курьера',exact:true})).toBeVisible();
    await expect(detail.locator('.timeline')).toHaveCount(0);await expect(detail.locator('.status-badge')).toHaveCount(0);
    await expect(detail.getByText('Хрупкое',{exact:true})).toBeVisible();
    await expect(detail.getByText('Платит получатель · наличными. Оплата курьеру.',{exact:true})).toBeVisible();
    await expect(detail.getByText('Позвонить у входа',{exact:true})).not.toBeVisible();
    await detail.getByText('Детали заказа',{exact:true}).click();await expect(detail.getByText('Позвонить у входа',{exact:true})).toBeVisible();await detail.getByText('Детали заказа',{exact:true}).click();
    for(const state of ['searching','delivered']){
      if(state==='delivered'){
        expect((await request.post(`/api/orders/${order.id}/accept`,{headers:headers(courier.sessionToken),data:{shareContact:true}})).status()).toBe(200);
        for(const status of ['PICKED_UP','IN_TRANSIT','DELIVERED'])expect((await request.post(`/api/orders/${order.id}/status`,{headers:headers(courier.sessionToken),data:{status}})).status()).toBe(200);
        await expect(detail.getByRole('heading',{name:'Посылка у получателя',exact:true})).toBeVisible();
        await expect(detail.locator('.timeline')).toHaveCount(0);await expect(detail.locator('.order-tracking')).not.toBeVisible();
        await expect(detail.locator('.recipient-share')).not.toBeVisible();
        await expect(detail.getByRole('heading',{name:'Как прошла доставка?',exact:true})).toBeVisible();
        await expect(detail.getByRole('textbox',{name:/Комментарий/})).toHaveCount(0);
      }
      for(const dark of [false,true]){
        await page.evaluate(dark=>window.__qadamTelegram!.changeTheme(dark),dark);
        for(const width of [320,390,768,1280]){
          await page.setViewportSize({width,height:844});expect(await page.locator('.screen-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
          await page.locator('.screen-body').evaluate(el=>el.scrollTop=0);
          if(state==='searching')await expect(detail.locator('.delivery-map-wrap')).toHaveCSS('height','210px');
          expect((await detail.locator('.compact-order-price .quote-price-row>span').boundingBox())!.height).toBeLessThanOrEqual(21);
          if(width===320||width===390)await page.screenshot({path:info.outputPath(`${state}-${dark?'dark':'light'}-${width}.png`)});
        }
      }
    }
    await page.setViewportSize({width:390,height:844});await detail.getByRole('radio',{name:'5',exact:true}).check();
    await detail.getByLabel('Комментарий · необязательно').fill('Всё вовремя');await detail.getByRole('button',{name:'Сохранить отзыв',exact:true}).click();
    await expect(detail.getByRole('heading',{name:'Ваш отзыв',exact:true})).toBeVisible();
    await page.reload();await expect(detail.getByRole('heading',{name:'Посылка у получателя',exact:true})).toBeVisible();
    await expect(detail.getByText('Всё вовремя',{exact:true})).toBeVisible();await expect(detail.locator('.timeline')).toHaveCount(0);
    const stored=(await(await request.get(`/api/orders/${order.id}`,{headers:headers(customer.sessionToken)})).json()).order;
    expect(stored.status).toBe('DELIVERED');expect(stored.events).toHaveLength(6);expect(stored.notes).toBe('Позвонить у входа');
    expect(errors).toEqual([]);
  }finally{await database().query('DELETE FROM qadam.orders WHERE customer_id=$1',[customer.user.id]);await database().query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])',[ids]);}
});
