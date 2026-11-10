import {expect,type APIRequestContext,type Browser,type Page,type TestInfo} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {signedTelegramData} from './telegram-fixture';
import {miniApp} from './e2e/telegram-browser-fixture';
import {mockMapTiles} from './e2e/map-fixture';
import {database} from '../src/lib/db';
import {readyCourier} from './courier-ready-fixture';
import type {User} from '../src/lib/types';
import {saveTelegramContact} from '../src/lib/user-profiles';
import sharp from 'sharp';

export async function safeDeliveryBrowser({page,request,browser,info,apiOrigin,appOrigin}:{page:Page;request:APIRequestContext;browser:Browser;info:TestInfo;apiOrigin:string;appOrigin:string}){
  const url=process.env.TEST_DATABASE_URL;
  if(!url||!['localhost','127.0.0.1'].includes(new URL(url).hostname)||!new URL(url).pathname.endsWith('_test'))throw new Error('Separate local test DB required');
  process.env.DATABASE_URL=url;await mockMapTiles(page.context());
  async function account(name:string){const proof=signedTelegramData({id:9100000000000+Math.floor(Math.random()*1e9),first_name:name});const response=await request.post(`${apiOrigin}/api/auth/telegram`,{headers:{Origin:appOrigin},data:{initData:proof}});expect(response.status()).toBe(200);return{...await response.json() as {user:User;sessionToken:string},proof};}
  const sender=await account('Отправитель безопасности'),driver=await account('Курьер безопасности');
  for(const [index,account] of [sender,driver].entries())await saveTelegramContact(account.user.telegramId!,`+7700000000${index}`,Date.now());
  const headers=(token:string)=>({Origin:appOrigin,Authorization:`Bearer ${token}`});
  await database().query("UPDATE qadam.users SET role='COURIER' WHERE id=$1",[driver.user.id]);driver.user.role='COURIER';
  await readyCourier(driver.user);
  await database().query('UPDATE qadam.courier_presence SET latitude=43.45,longitude=77.25 WHERE user_id=$1',[driver.user.id]);
  const created=await request.post(`${apiOrigin}/api/orders`,{headers:headers(sender.sessionToken),data:{requestKey:randomUUID(),pickupAddress:'Алматы, Абая 100',destinationAddress:'Алматы, Самал 111',pickupPoint:{latitude:43.24,longitude:76.9},destinationPoint:{latitude:43.25,longitude:76.91},recipientName:'Получатель безопасности',recipientPhone:'+77000000011',notes:'Небольшая коробка',shareContact:true}});expect(created.status()).toBe(201);
  let order=(await created.json()).order;const id=order.id;
  const customerContext=await browser.newContext({viewport:{width:390,height:844}}),customer=await customerContext.newPage();await mockMapTiles(customerContext);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));customer.on('pageerror',e=>errors.push(e.message));
  try{
    await miniApp(page,driver.proof,780,appOrigin,{query:`order=${id}`,native:{}});
    await page.evaluate(()=>{document.documentElement.dataset.gpsLatitude='43.45';document.documentElement.dataset.gpsLongitude='77.25';});
    await move(43.45,77.25);
    const main=()=>page.evaluate(()=>window.__qadamTelegram!.main);
    const press=()=>page.evaluate(()=>window.__qadamTelegram!.pressMain());
    await expect.poll(main).toMatchObject({text:'Принять заказ',active:true});
    const acceptance=page.waitForResponse(r=>r.url()===`${apiOrigin}/api/orders/${id}/accept`&&r.request().method()==='POST');
    await press();const accepted=await acceptance;expect(accepted.status()).toBe(200);order=(await accepted.json()).order;
    await move(43.45,77.25);
    await expect(page.getByRole('heading',{name:'Заберите посылку',exact:true})).toBeVisible();
    await expect(page.getByRole('link',{name:'Маршрут в 2ГИС'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Закончить после доставки',exact:true})).not.toBeVisible();
    await expect(page.getByRole('button',{name:'Настройки геолокации',exact:true})).not.toBeVisible();
    await expect(page.getByRole('button',{name:'Подключить трансляцию Telegram',exact:true})).not.toBeVisible();
    await expect.poll(main).toMatchObject({text:'Подтвердить забор',active:true});
    await expect(page.getByRole('status').filter({hasText:'Подойдите к отправителю'})).toBeVisible();
    await press();await expect(page.getByRole('heading',{name:'Получите посылку',exact:true})).toBeVisible();
    await expect(page.getByText('Подойдите к отправителю. Подтверждение доступно у адреса.',{exact:true})).toBeVisible();
    await expect.poll(main).toMatchObject({text:'Подтвердить забор',active:false});
    await page.screenshot({path:info.outputPath('pickup-confirm-location-required.png')});
    const pending=await request.get(`${apiOrigin}/api/orders/${id}`,{headers:headers(driver.sessionToken)});expect(pending.status()).toBe(200);expect((await pending.json()).order.status).toBe('ACCEPTED');
    const generic=await request.post(`${apiOrigin}/api/orders/${id}/status`,{headers:headers(driver.sessionToken),data:{status:'PICKED_UP'}});expect(generic.status()).toBe(409);
    await miniApp(customer,sender.proof,780,appOrigin,{query:`order=${id}`,native:{}});
    await expect(customer.getByRole('button',{name:'Показать код забора'})).toBeDisabled();
    await expect(customer.getByRole('link',{name:'Маршрут в 2ГИС'})).toHaveCount(0);
    await expect(customer.getByRole('button',{name:'Настройки геолокации'})).toHaveCount(0);
    async function move(latitude:number,longitude:number){
      await page.evaluate(({latitude,longitude})=>{document.documentElement.dataset.gpsLatitude=String(latitude);document.documentElement.dataset.gpsLongitude=String(longitude);},{latitude,longitude});
      // Deterministic device movement, through the real authenticated location API.
      await database().query("UPDATE qadam.courier_presence SET received_at=clock_timestamp()-interval '6 seconds',captured_at=clock_timestamp()-interval '6 seconds' WHERE user_id=$1",[driver.user.id]);
      const response=await request.post(`${apiOrigin}/api/courier/location`,{headers:headers(driver.sessionToken),data:{latitude,longitude,accuracy:22,capturedAt:new Date().toISOString()}});expect(response.status()).toBe(200);
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    }
    await page.evaluate(()=>{document.documentElement.dataset.gpsLatitude='43.24';document.documentElement.dataset.gpsLongitude='76.9';});
    await database().query("UPDATE qadam.courier_presence SET received_at=clock_timestamp()-interval '6 seconds',captured_at=clock_timestamp()-interval '6 seconds' WHERE user_id=$1",[driver.user.id]);
    const locationUpdate=page.waitForResponse(r=>r.url()===`${apiOrigin}/api/courier/location`&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Обновить позицию',exact:true}).click();expect((await locationUpdate).status()).toBe(200);
    await expect(page.getByText('Подойдите к отправителю. Подтверждение доступно у адреса.',{exact:true})).toHaveCount(0);
    await expect(customer.getByRole('button',{name:'Показать код забора'})).toBeEnabled();await customer.getByRole('button',{name:'Показать код забора'}).click();
    const shown=customer.locator('.delivery-code');await expect(shown).toHaveText(/^\d{6}$/);const pickupCode=(await shown.textContent())!;
    expect((await request.get(`${apiOrigin}/api/orders/${id}/handoff-code?stage=PICKUP`,{headers:headers(driver.sessionToken)})).status()).toBe(403);
    await expect(page.getByRole('heading',{name:'Код отправителя',exact:true})).toBeVisible();
    await expect(page.getByRole('heading',{name:'Фото вручения',exact:true})).toHaveCount(0);
    await page.getByLabel('6 цифр',{exact:true}).fill(pickupCode);await page.getByRole('checkbox',{name:'Посылка у меня',exact:true}).check();
    await expect.poll(main).toMatchObject({text:'Подтвердить забор',active:true});
    await page.screenshot({path:info.outputPath('pickup-confirm-ready.png')});
    const pickupResponse=page.waitForResponse(r=>r.url()===`${apiOrigin}/api/orders/${id}/handoff`&&r.request().method()==='POST');await press();expect((await pickupResponse).status()).toBe(200);
    await expect(page.getByRole('heading',{name:'Доставьте получателю'})).toBeVisible();
    await expect.poll(main).toMatchObject({text:'Подтвердить вручение',active:true});
    await expect(page.getByRole('button',{name:'Начать доставку'})).toHaveCount(0);
    await expect(customer.getByRole('button',{name:'Показать код вручения'})).toBeVisible();await customer.getByRole('button',{name:'Показать код вручения'}).click();await expect(shown).toHaveText(/^\d{6}$/);const dropCode=(await shown.textContent())!;expect(dropCode).not.toBe(pickupCode);
    await expect(customer.getByRole('link',{name:'Отправить код в WhatsApp'})).toHaveAttribute('href',new RegExp(`wa.me/77000000011\\?text=.*${dropCode}`));
    for(const dark of [false,true]){
      for(const screen of [page,customer]){
        await screen.evaluate(dark=>window.__qadamTelegram!.changeTheme(dark),dark);
        for(const width of [320,390,768,1280]){await screen.setViewportSize({width,height:844});expect(await screen.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
      }
    }
    await page.setViewportSize({width:390,height:844});await customer.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath('safe-courier-in-transit-dark.png')});await customer.screenshot({path:info.outputPath('safe-customer-code.png')});
    await move(43.25,76.91);await expect.poll(main).toMatchObject({text:'Подтвердить вручение',active:true});await press();
    if(order.photoRequired){
      const image=await sharp({create:{width:80,height:60,channels:3,background:'#b4c6d0'}}).jpeg().toBuffer();
      await page.getByLabel('Выбрать фото вручения',{exact:true}).setInputFiles({name:'parcel.jpg',mimeType:'image/jpeg',buffer:image});
      await page.getByRole('button',{name:'Сохранить фото',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Фото сохранено'})).toBeVisible();
    }
    await page.getByLabel('6 цифр',{exact:true}).fill(dropCode);await page.getByRole('checkbox',{name:'Посылка передана получателю',exact:true}).check();
    await expect.poll(main).toMatchObject({text:'Завершить доставку',active:true});const delivered=page.waitForResponse(r=>r.url()===`${apiOrigin}/api/orders/${id}/handoff`&&r.request().method()==='POST');await press();expect((await delivered).status()).toBe(200);
    await expect(page.getByRole('heading',{name:'Доставка завершена'})).toBeVisible();await page.reload();await expect(page.getByRole('heading',{name:'Доставка завершена'})).toBeVisible();
    const proofs=(await database().query('SELECT stage FROM qadam.order_handoff_proofs WHERE order_id=$1',[id])).rows;expect(proofs.map(p=>p.stage).sort()).toEqual(['DROPOFF','PICKUP']);expect(errors).toEqual([]);
  }finally{await customerContext.close();await database().query('DELETE FROM qadam.orders WHERE id=$1',[id]);await database().query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])',[[sender.user.id,driver.user.id]]);}
}
