import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { signedTelegramData } from '../telegram-fixture';
import { miniApp } from './telegram-browser-fixture';
import { mockMapTiles } from './map-fixture';

test.skip(Boolean(process.env.E2E_ORIGIN), 'Local synthetic accounts only');
const origin = 'http://127.0.0.1:3100';
const headers = (token: string) => ({ Authorization: `Bearer ${token}`, Origin: origin });
async function fixture(request: APIRequestContext) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Separate _test database required');
  const db = new pg.Client({ connectionString: url }); await db.connect();
  async function account(name: string) {
    const telegramId = 4400000000000 + Math.floor(Math.random()*1000000000);
    const proof = signedTelegramData({id:telegramId,first_name:name});
    const response = await request.post('/api/auth/telegram',{headers:{Origin:origin},data:{initData:proof}});
    expect(response.status()).toBe(200);
    return { ...(await response.json()), proof, telegramId };
  }
  const customer = await account('Клиент уведомлений'), courier = await account('Курьер уведомлений'), admin = await account('Администратор уведомлений');
  const ids = [customer.user.id,courier.user.id,admin.user.id];
  await db.query('INSERT INTO qadam.administrators(user_id) VALUES($1)',[admin.user.id]);
  const submitted = await request.post('/api/courier-application',{headers:headers(courier.sessionToken),data:{phone:'+77000000000',transport:'FOOT',district:'ALMALY',availability:['DAY'],ageConfirmed:true,acceptRules:true,notes:''}});
  expect(submitted.status()).toBe(201);
  expect((await request.post(`/api/admin/courier-applications/${(await submitted.json()).application.id}`,{headers:headers(admin.sessionToken),data:{decision:'APPROVED',reason:''}})).status()).toBe(200);
  async function order() {
    const response = await request.post('/api/orders',{headers:headers(customer.sessionToken),data:{requestKey:randomUUID(),pickupAddress:'Абая 10, Алматы',destinationAddress:'Ауэзова 20, Алматы',recipientName:'Получатель ссылки',recipientPhone:'+77001234567',notes:''}});
    expect(response.status()).toBe(201); return (await response.json()).order;
  }
  async function cleanup() {
    await db.query('DELETE FROM qadam.orders WHERE customer_id=ANY($1::uuid[])',[ids]);
    await db.query('DELETE FROM qadam.telegram_outbox WHERE telegram_user_id=ANY($1::bigint[])',[[customer.telegramId,courier.telegramId,admin.telegramId]]);
    await db.query('DELETE FROM qadam.courier_applications WHERE user_id=ANY($1::uuid[])',[ids]);
    await db.query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])',[ids]); await db.end();
  }
  return {db,customer,courier,admin,order,cleanup};
}

test('courier shift persists, failed saves retain the switch, retries work and expiry turns it off', async ({page,request},info) => {
  const f=await fixture(request); await mockMapTiles(page.context()); await page.setViewportSize({width:390,height:844});
  try {
    await miniApp(page,f.courier.proof,844);
    const toggle=page.getByRole('switch',{name:'Я на линии'}), section=page.getByRole('region',{name:'Готовность к заказам'});
    await expect(toggle).toBeEnabled(); await expect(toggle).toHaveAttribute('aria-checked','false'); await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked','true'); await expect(section.getByRole('button',{name:'Разрешить сообщения'})).toBeVisible();
    await section.getByRole('button',{name:'Разрешить сообщения'}).click(); await expect(section.getByRole('status')).toContainText('Уведомления выключены');
    await page.reload(); await expect(toggle).toHaveAttribute('aria-checked','true');
    await page.route('**/api/courier/status',async route => {
      if(route.request().method()==='POST') await route.fulfill({status:503,json:{error:'Временная ошибка'}}); else await route.continue();
    });
    await toggle.click(); await expect(section.getByRole('alert')).toContainText('Предыдущее состояние сохранено');
    await expect(toggle).toHaveAttribute('aria-checked','true'); await page.screenshot({path:info.outputPath('courier-status-error.png'),fullPage:true});
    await page.unroute('**/api/courier/status'); await section.getByRole('button',{name:'Повторить',exact:true}).click();
    await expect(toggle).toHaveAttribute('aria-checked','false'); await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked','true');
    await f.db.query("UPDATE qadam.courier_status SET updated_at=now()-interval '9 hours' WHERE user_id=$1",[f.courier.user.id]);
    await page.reload(); await expect(toggle).toHaveAttribute('aria-checked','false'); await expect(section).toContainText('Смена завершилась');
    for(const width of [320,360,390,1440]) {
      await page.setViewportSize({width,height:844}); expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await page.setViewportSize({width:390,height:844}); await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked','true');
    const permitted=signedTelegramData({id:f.courier.telegramId,first_name:'Курьер уведомлений',allows_write_to_pm:true});
    await miniApp(page,permitted,844); await page.reload();
    await expect(section).toContainText('Новые заказы придут в Telegram');
    await page.screenshot({path:info.outputPath('courier-status-online.png'),fullPage:true});
    expect((await request.post('/api/courier/status',{headers:headers(f.customer.sessionToken),data:{online:true}})).status()).toBe(403);
    expect((await request.post('/api/courier/status',{headers:headers(f.courier.sessionToken),data:{online:true,userId:f.customer.user.id}})).status()).toBe(400);
  } finally { await f.cleanup(); }
});

test('UUID and signed order-number links open deliveries and revoked administrators lose access', async ({browser,request}) => {
  const f=await fixture(request); const context=await browser.newContext({viewport:{width:390,height:844}}); await mockMapTiles(context);
  const page=await context.newPage();
  try {
    const order=await f.order();
    const proof=signedTelegramData({id:f.customer.telegramId,first_name:'Клиент уведомлений'},{start_param:`order_${order.number}`});
    await miniApp(page,proof,844);
    await expect(page.getByRole('region',{name:'Детали заказа'})).toContainText('Получатель ссылки');
    await expect(page.locator('.app-bar')).toContainText(`QD-${order.number.padStart(4,'0')}`);
    await miniApp(page,f.courier.proof,844,'',{query:`order=${order.id}`});
    await expect(page.getByRole('region',{name:'Детали заказа'})).toContainText('Контакты получателя откроются');
    await page.getByRole('button',{name:'Принять заказ',exact:true}).click();
    await expect(page.getByRole('region',{name:'Детали заказа'})).toContainText('Получатель ссылки');
    await miniApp(page,f.admin.proof,844,'',{query:`screen=adminOrders&order=${order.id}`});
    await expect(page.getByRole('region',{name:'Наблюдение за заказом'})).toContainText('Получатель ссылки');
    await f.db.query('DELETE FROM qadam.administrators WHERE user_id=$1',[f.admin.user.id]);
    expect((await request.get(`/api/orders/${order.id}`,{headers:headers(f.admin.sessionToken)})).status()).toBe(404);
    await miniApp(page,f.admin.proof,844,'',{query:`order=${order.id}`});
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Заказ не найден');
    await expect(page.getByRole('region',{name:'Детали заказа'})).toHaveCount(0);
  } finally { await context.close(); await f.cleanup(); }
});
