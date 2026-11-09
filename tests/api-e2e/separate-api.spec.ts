import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { miniApp } from '../e2e/telegram-browser-fixture';
import { signedTelegramData } from '../telegram-fixture';
import { mockMapTiles } from '../e2e/map-fixture';
import { database,closeDatabase } from '../../src/lib/db';
import { saveTelegramContact } from '../../src/lib/user-profiles';
import {locationConsentVersion} from '../../src/lib/location-consent';

const api = 'http://127.0.0.1:3102';
const frontend = 'http://127.0.0.1:3103';
async function nativeMain(page:import('@playwright/test').Page,text:string){
  await expect.poll(()=>page.evaluate(()=>window.__qadamTelegram!.main)).toMatchObject({text,visible:true,active:true});
  await page.evaluate(()=>window.__qadamTelegram!.pressMain());
}

test('frontend exposes no API; the standalone API preserves CORS, authentication and streamed body limits', async ({ request }) => {
  expect((await request.get('/api/session')).status()).toBe(404);
  expect((await request.get(`${api}/health`)).status()).toBe(200);
  expect((await request.get(`${api}/api/orders`, { headers: { Origin: frontend } })).status()).toBe(401);
  expect((await request.post(`${api}/api/geocoding/reverse`, { headers: { Origin: frontend }, data: { latitude: 43.24, longitude: 76.9 } })).status()).toBe(401);
  const reversePreflight = await request.fetch(`${api}/api/geocoding/reverse`, { method: 'OPTIONS', headers: {
    Origin: frontend, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type',
  } });
  expect(reversePreflight.status()).toBe(204);
  expect(reversePreflight.headers()['access-control-allow-origin']).toBe(frontend);
  const allowed = await request.fetch(`${api}/api/auth/telegram`, { method: 'OPTIONS', headers: {
    Origin: frontend, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type',
  } });
  expect(allowed.status()).toBe(204);
  expect(allowed.headers()['access-control-allow-origin']).toBe(frontend);
  for (const origin of ['null', 'https://evil.example', `${frontend}.evil.example`]) {
    const forbidden = await request.get(`${api}/api/session`, { headers: { Origin: origin } });
    expect(forbidden.status()).toBe(403);
    expect(forbidden.headers()['access-control-allow-origin']).toBeUndefined();
  }
  expect((await request.post(`${api}/api/auth/telegram`, { headers: { Origin: frontend }, data: { initData: 'x'.repeat(17000) } })).status()).toBe(413);
  expect((await request.post(`${api}/api/auth/telegram`, { headers: { Origin: frontend }, data: { initData: 'forged' } })).status()).toBe(401);
  expect((await request.post(`${api}/api/telegram/webhook`, { data: { update_id: 1 } })).status()).toBe(401);
  for(const method of ['PUT','DELETE']){
    const result=await request.fetch(`${api}/api/business-profile`,{method:'OPTIONS',headers:{Origin:frontend,'Access-Control-Request-Method':method,'Access-Control-Request-Headers':'authorization, content-type'}});
    expect(result.status()).toBe(204);expect(result.headers()['access-control-allow-methods']).toContain(method);
    expect((await request.fetch(`${api}/api/business-profile`,{method,headers:{Origin:frontend},data:{}})).status()).toBe(401);
  }
});

test('Mini App completes a delivery through a separate API without cookies and restores it after reload', async ({ page, playwright }, testInfo) => {
  await mockMapTiles(page.context());
  const proof = signedTelegramData({ id: 7400000000000 + Math.floor(Math.random() * 1000000000), first_name: 'Отдельный API' });
  const loginResponse = page.waitForResponse(response => response.url() === `${api}/api/auth/telegram` && response.request().method() === 'POST');
  await miniApp(page, proof,760,'',{native:{}});
  expect((await loginResponse).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Куда доставить?', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Указать адреса', exact: true }).click();
  const pickup = `Алматы, отдельный API ${randomUUID().slice(0, 6)}`;
  let chosenPoint: { latitude: number; longitude: number } | undefined;
  await page.route(`${api}/api/geocoding/reverse`, async (route) => {
    expect((await route.request().allHeaders()).authorization).toMatch(/^Bearer /);
    chosenPoint = route.request().postDataJSON();
    await route.fulfill({ json: { result: { ...chosenPoint, id: 'separate-api-house', address: pickup, fullAddress: pickup, detail: 'Алматы', precision: 'building' } } });
  });
  await page.getByLabel('Адрес отправления', { exact: true }).fill(pickup);
  await page.getByRole('button', { name: 'Указать вручную на карте', exact: true }).click();
  await page.getByRole('button', { name: 'Выбрать точку в центре', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Проверка точки' })).toContainText(pickup);
  await nativeMain(page,'Подтвердить точку');
  await page.getByLabel('Адрес доставки', { exact: true }).fill('Алматы, улица Абая, 20');
  await nativeMain(page,'Выбрать адрес');
  await page.getByRole('button', { name: 'Далее — получатель', exact: true }).click();
  await page.getByLabel('Имя получателя', { exact: true }).fill('Проверка отдельного API');
  await page.getByLabel('Телефон получателя', { exact: true }).fill('+7 700 000 00 00');
  await nativeMain(page,'Проверить заказ');
  const created = page.waitForResponse(response => response.url() === `${api}/api/orders` && response.request().method() === 'POST');
  await nativeMain(page,'Подтвердить заказ');
  const response = await created;
  expect(response.status()).toBe(201);
  expect((await response.request().allHeaders()).authorization).toMatch(/^Bearer /);
  const { order } = await response.json();
  expect(chosenPoint).toBeDefined(); expect(order.pickupAddress).toBe(pickup); expect(order.pickupPoint).toEqual(chosenPoint);
  const courier = await playwright.request.newContext({ baseURL: api, extraHTTPHeaders: { Origin: frontend } });
  try {
    expect((await courier.post('/api/auth/login', { data: { email: 'courier1@qadam.demo', password: process.env.DEMO_PASSWORD } })).status()).toBe(200);
    const proofConfig=await courier.get('/api/delivery-proof');expect(proofConfig.status()).toBe(200);expect((await proofConfig.json()).enabled).toBe(false);
    expect((await courier.get('/api/courier/location-preferences')).status()).toBe(200);
    expect((await courier.post('/api/courier/location-preferences',{data:{autoEnabled:true,consentVersion:locationConsentVersion}})).status()).toBe(200);
    expect((await courier.post('/api/courier/status', { data: { online: true } })).status()).toBe(200);
    expect((await courier.post('/api/courier/location', { data: { sharing:true,consent:true } })).status()).toBe(200);
    expect((await courier.post('/api/courier/location', { data: { latitude:43.24,longitude:76.9,accuracy:22,capturedAt:new Date().toISOString() } })).status()).toBe(200);
    expect((await (await courier.get('/api/courier/status')).json()).status.online).toBe(true);
    expect((await (await courier.get(`/api/orders/${order.id}`)).json()).order.recipientPhone).toBeNull();
    expect((await courier.post(`/api/orders/${order.id}/accept`, { data: {} })).status()).toBe(200);
    const trust=await courier.get(`/api/orders/${order.id}/trust`);expect(trust.status()).toBe(200);
    const stream=await courier.get(`/api/orders/${order.id}/location-stream`);expect(stream.status()).toBe(200);expect((await stream.json()).enabled).toBe(false);
    expect((await courier.get(`/api/orders/${order.id}/code`)).status()).toBe(403);
    expect((await courier.get(`/api/admin/orders/${order.id}/manage`)).status()).toBe(403);
    for (const status of ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED']) {
      expect((await courier.post(`/api/orders/${order.id}/status`, { data: { status } })).status()).toBe(200);
    }
    expect((await (await courier.get(`/api/orders/${order.number}`)).json()).order.status).toBe('DELIVERED');
    expect((await courier.post('/api/courier/status', { data: { online: false } })).status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Посылка у получателя', exact: true })).toBeVisible();
    await page.getByRole('radio',{name:'5',exact:true}).check();
    await page.getByLabel('Комментарий · необязательно',{exact:true}).fill('Отзыв через отдельный API');
    await page.getByRole('button',{name:'Сохранить отзыв',exact:true}).click();
    await expect(page.getByText('Отзыв сохранён. Для исправления напишите команде Qadam.',{exact:true})).toBeVisible();
    expect(Object.hasOwn((await (await courier.get(`/api/orders/${order.id}/trust`)).json()).trust,'rating')).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('separate-api-delivered.png'), fullPage: true });
    await page.reload();
    await page.getByRole('navigation', { name: 'Мобильная навигация', exact: true }).getByRole('button', { name: 'Заказы', exact: true }).click();
    await page.getByRole('button', { name: 'Завершённые', exact: true }).click();
    await expect(page.getByRole('main')).toContainText(pickup);
    expect(await page.context().cookies()).toHaveLength(0);
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  } finally { await courier.dispose(); }
});

test('separate API failure is visible and the interface can recover', async ({ page }) => {
  await mockMapTiles(page.context());
  await miniApp(page, signedTelegramData({ id: 7500000000000 + Math.floor(Math.random() * 1000000000), first_name: 'Восстановление API' }));
  await expect(page.getByRole('heading', { name: 'Куда доставить?', exact: true })).toBeVisible();
  let unavailable = true;
  await page.route(`${api}/api/orders`, route => unavailable ? route.abort() : route.continue());
  await page.reload();
  const error = page.getByRole('main').getByRole('alert');
  await expect(error).toContainText('Нет связи с сервером');
  unavailable = false;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(error).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Куда доставить?', exact: true })).toBeVisible();
});

test('authenticated shop CRUD works from the separate frontend with browser CORS preflights',async({page,request})=>{
  const url=process.env.TEST_DATABASE_URL;
  if(!url||!new URL(url).pathname.endsWith('_test')||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('Separate local _test database required');
  process.env.DATABASE_URL=url;
  const telegramId=7600000000000+Math.floor(Math.random()*1000000000);
  const response=await request.post(`${api}/api/auth/telegram`,{headers:{Origin:frontend},data:{initData:signedTelegramData({id:telegramId,first_name:'Магазин отдельного API'})}});
  expect(response.status()).toBe(200);const account=await response.json();
  try{
    await saveTelegramContact(String(telegramId),'+77000000042',Date.now());
    await mockMapTiles(page.context());await page.goto('/');
    const profile={name:'Магазин отдельного API',pickupAddress:'Абая, 100, Алматы',pickupPoint:{latitude:43.24,longitude:76.9},pickupDetails:'Вход со двора'};
    const call=(method:string,body?:unknown)=>page.evaluate(async({method,body,token,api})=>{
      const result=await fetch(`${api}/api/business-profile`,{method,credentials:'omit',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
      return {status:result.status,body:await result.json()};
    },{method,body,token:account.sessionToken,api});
    const put=await call('PUT',profile);expect(put.status).toBe(200);expect(put.body.profile.name).toBe(profile.name);
    expect((await call('GET')).body.profile.pickupAddress).toBe(profile.pickupAddress);
    expect((await call('DELETE',{})).status).toBe(200);expect((await call('GET')).body.profile).toBeNull();
    expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual([]);
  }finally{await database().query('DELETE FROM qadam.users WHERE id=$1',[account.user.id]);await closeDatabase();}
});
