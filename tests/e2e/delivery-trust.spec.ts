import {enableShiftGps} from './courier-gps-fixture';
import {test,expect,type APIRequestContext,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import {signedTelegramData} from '../telegram-fixture';
import {miniApp} from './telegram-browser-fixture';
import {mockMapTiles} from './map-fixture';
import {saveTelegramContact} from '../../src/lib/user-profiles';
import {closeDatabase} from '../../src/lib/db';

test.skip(Boolean(process.env.E2E_ORIGIN),'Synthetic local delivery trust accounts only');
test.use({baseURL:'http://127.0.0.1:3104',viewport:{width:390,height:844}});
const origin='http://127.0.0.1:3104';
type Account={user:{id:string;name:string};sessionToken:string;proof:string;telegramId:number};
function authenticated(account:Account){return{Origin:origin,Authorization:`Bearer ${account.sessionToken}`};}
async function fixture(request:APIRequestContext){
  const url=process.env.TEST_DATABASE_URL;
  if(!url||!new URL(url).pathname.endsWith('_test')||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('Local _test database required');
  process.env.DATABASE_URL=url;const db=new pg.Client({connectionString:url});await db.connect();
  const accounts:Account[]=[],contexts:BrowserContext[]=[],errors:string[]=[];
  async function purge(ids:string[],telegramIds:number[]){
    await db.query('DELETE FROM qadam.orders WHERE customer_id=ANY($1::uuid[])',[ids]);
    await db.query('DELETE FROM qadam.telegram_outbox WHERE telegram_user_id=ANY($1::bigint[])',[telegramIds]);
    await db.query('DELETE FROM qadam.courier_applications WHERE user_id=ANY($1::uuid[])',[ids]);
    await db.query('DELETE FROM qadam.courier_block_events WHERE user_id=ANY($1::uuid[])',[ids]);
    await db.query('DELETE FROM qadam.courier_blocks WHERE user_id=ANY($1::uuid[])',[ids]);
    await db.query('DELETE FROM qadam.users WHERE id=ANY($1::uuid[])',[ids]);
  }
  // Recover only this suite's synthetic identities after a prior interrupted run.
  const stale=(await db.query('SELECT u.id,t.telegram_user_id::text AS telegram FROM qadam.users u JOIN qadam.telegram_identities t ON t.user_id=u.id WHERE t.telegram_user_id BETWEEN 5400000000000 AND 5400999999999 AND u.name=ANY($1::text[])',[['Отправитель вручения','Курьер вручения','Другой отправитель','Клиент диспетчера','Курьер до отказа','Курьер после смены','Диспетчер Qadam']])).rows;
  if(stale.length)await purge(stale.map(u=>u.id),stale.map(u=>Number(u.telegram)));
  async function account(name:string){
    const telegramId=5400000000000+Math.floor(Math.random()*1000000000),proof=signedTelegramData({id:telegramId,first_name:name,allows_write_to_pm:true});
    const response=await request.post('/api/auth/telegram',{headers:{Origin:origin},data:{initData:proof}});expect(response.status()).toBe(200);
    const result={...await response.json(),proof,telegramId} as Account;accounts.push(result);
    await saveTelegramContact(String(telegramId),`+770000004${10+accounts.length}`,Date.now());return result;
  }
  async function page(browser:Browser,actor:Account,query=''){
    const context=await browser.newContext({viewport:{width:390,height:844}});contexts.push(context);await mockMapTiles(context);
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await miniApp(page,actor.proof,760,origin,{query});return page;
  }
  async function approve(actor:Account,reviewer:Account){await db.query("INSERT INTO qadam.courier_applications(user_id,phone,transport,status,reviewed_at,reviewed_by) VALUES($1,'+77000000422','CAR','APPROVED',now(),$2)",[actor.user.id,reviewer.user.id]);}
  async function clean(){
    for(const context of contexts)await context.close();
    const ids=accounts.map(a=>a.user.id);
    try{await purge(ids,accounts.map(a=>a.telegramId));}finally{await db.end();await closeDatabase();}
  }
  await db.query('UPDATE qadam.pricing_settings SET active=false');
  return{db,accounts,errors,account,page,approve,clean};
}
async function noOverflow(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
const payload=()=>({requestKey:randomUUID(),pickupAddress:'Алматы, Абая 100',destinationAddress:'Алматы, Самал 111',recipientName:'Получатель проверки',recipientPhone:'+77000000433',notes:'Синтетический заказ',shareContact:true});

test('photo and optional code complete the real browser/API/database flow, including a lost upload response and private rating',async({browser,request},info)=>{
  test.setTimeout(150000);const f=await fixture(request);
  try{
    const owner=await f.account('Отправитель вручения'),courier=await f.account('Курьер вручения'),other=await f.account('Другой отправитель');await f.approve(courier,owner);
    const customerPage=await f.page(browser,owner);
    await customerPage.getByRole('button',{name:'Указать адреса',exact:true}).click();
    await customerPage.getByLabel('Адрес отправления',{exact:true}).fill('Алматы, Абая 100');await customerPage.getByRole('button',{name:'Выбрать адрес',exact:true}).click();
    await customerPage.getByLabel('Адрес доставки',{exact:true}).fill('Алматы, Самал 111');await customerPage.getByRole('button',{name:'Выбрать адрес',exact:true}).click();
    await customerPage.getByRole('button',{name:'Далее — получатель',exact:true}).click();
    await customerPage.getByLabel('Имя получателя',{exact:true}).fill('Получатель проверки');await customerPage.getByLabel('Телефон получателя',{exact:true}).fill('+77000000433');
    await customerPage.getByRole('button',{name:'Проверить заказ',exact:true}).click();
    const optionalCode=customerPage.getByRole('checkbox',{name:/^Код при вручении/});await expect(optionalCode).not.toBeChecked();await optionalCode.check();
    await noOverflow(customerPage);await customerPage.screenshot({path:info.outputPath('review-mobile.png')});
    const created=customerPage.waitForResponse(response=>new URL(response.url()).pathname==='/api/orders'&&response.request().method()==='POST');
    await customerPage.getByRole('button',{name:'Подтвердить заказ',exact:true}).click();const order=(await (await created).json()).order;
    expect(order.photoRequired).toBe(true);expect(order.codeRequired).toBe(true);
    await customerPage.getByRole('button',{name:'Показать код',exact:true}).click();
    const codeResponse=await request.get(`/api/orders/${order.id}/code`,{headers:authenticated(owner)}),code=(await codeResponse.json()).code;
    await expect(customerPage.locator('.delivery-code')).toHaveText(code);await customerPage.locator('.delivery-code').scrollIntoViewIfNeeded();await customerPage.screenshot({path:info.outputPath('customer-code-mobile.png')});
    expect((await request.get(`/api/orders/${order.id}/code`,{headers:authenticated(other)})).status()).toBe(404);
    const courierPage=await f.page(browser,courier,`order=${order.id}`);
    await enableShiftGps(courierPage);await courierPage.getByRole('button',{name:'Принять заказ',exact:true}).click();
    await courierPage.getByRole('button',{name:'Посылка у меня',exact:true}).click();await courierPage.getByRole('button',{name:'Начать доставку',exact:true}).click();
    await courierPage.getByRole('button',{name:'Завершить доставку',exact:true}).click();
    await expect(courierPage.getByRole('heading',{name:'Передайте посылку',exact:true})).toBeVisible();
    const complete=courierPage.getByRole('button',{name:'Завершить доставку',exact:true});await expect(complete).toBeDisabled();
    const image=await sharp({create:{width:600,height:400,channels:3,background:'#c8b09a'}}).jpeg().withMetadata({orientation:1}).toBuffer();
    let lost=false;
    await courierPage.route('**/api/orders/*/photo',async route=>{
      if(route.request().method()==='POST'&&!lost){lost=true;const saved=await route.fetch();expect(saved.status()).toBe(200);await route.abort('failed');}else await route.fallback();
    });
    await courierPage.getByLabel('Выбрать фото вручения',{exact:true}).setInputFiles({name:'package.jpg',mimeType:'image/jpeg',buffer:image});
    await courierPage.getByRole('button',{name:'Сохранить фото',exact:true}).click();await expect(courierPage.getByRole('alert').filter({hasText:'Нет связи'})).toBeVisible();
    await expect(complete).toBeDisabled();await courierPage.getByRole('button',{name:'Сохранить фото',exact:true}).click();await expect(courierPage.getByText('Фото сохранено',{exact:true})).toBeVisible();
    expect((await f.db.query('SELECT count(*)::int AS n FROM qadam.order_photos WHERE order_id=$1',[order.id])).rows[0].n).toBe(1);
    await courierPage.getByLabel('4 цифры',{exact:true}).fill(code==='0000'?'0001':'0000');await courierPage.getByRole('checkbox',{name:'Посылка передана получателю',exact:true}).check();
    await complete.click();await expect(courierPage.getByRole('alert').filter({hasText:'Код не подошёл'})).toBeVisible();await expect(courierPage.getByText('Осталось попыток: 4',{exact:true})).toBeVisible();
    await courierPage.getByLabel('4 цифры',{exact:true}).fill(code);
    for(const width of [320,390,768,1280]){await courierPage.setViewportSize({width,height:900});await noOverflow(courierPage);if(width===1280)await courierPage.screenshot({path:info.outputPath('handoff-desktop.png')});}
    await courierPage.setViewportSize({width:390,height:844});await courierPage.getByRole('heading',{name:'Фото вручения',exact:true}).scrollIntoViewIfNeeded();await courierPage.screenshot({path:info.outputPath('handoff-photo-mobile.png')});
    await courierPage.getByLabel('4 цифры',{exact:true}).scrollIntoViewIfNeeded();await courierPage.screenshot({path:info.outputPath('handoff-code-mobile.png')});
    await complete.click();await expect(courierPage.getByRole('heading',{name:'Доставка завершена',exact:true})).toBeVisible();
    await expect(customerPage.getByRole('heading',{name:'Посылка у получателя',exact:true})).toBeVisible();
    await customerPage.getByRole('button',{name:'Посмотреть фото',exact:true}).click();await expect(customerPage.getByAltText('Упаковка в месте вручения')).toBeVisible();
    await customerPage.getByRole('radio',{name:'5',exact:true}).check();await customerPage.getByLabel('Комментарий · необязательно').fill('Упаковка целая, всё вовремя');
    await customerPage.getByRole('button',{name:'Сохранить отзыв',exact:true}).click();await expect(customerPage.getByRole('heading',{name:'Ваш отзыв',exact:true})).toBeVisible();
    await customerPage.getByRole('heading',{name:'Ваш отзыв',exact:true}).scrollIntoViewIfNeeded();await customerPage.screenshot({path:info.outputPath('customer-rating-mobile.png')});
    const courierTrust=await request.get(`/api/orders/${order.id}/trust`,{headers:authenticated(courier)});expect(Object.hasOwn((await courierTrust.json()).trust,'rating')).toBe(false);
    expect((await request.get(`/api/orders/${order.id}/photo`,{headers:authenticated(other)})).status()).toBe(404);
    await f.db.query('UPDATE qadam.order_photos SET expires_at=$2 WHERE order_id=$1',[order.id,new Date(Date.now()-60000)]);
    expect((await request.get(`/api/orders/${order.id}/photo`,{headers:authenticated(owner)})).status()).toBe(410);
    await expect(customerPage.getByText('Срок доступа закончился. Фото больше не выдаётся в приложении.',{exact:true})).toBeVisible();
    await customerPage.getByRole('button',{name:'Повторить заказ',exact:true}).click();await customerPage.getByRole('button',{name:'Проверить заказ',exact:true}).click();await expect(optionalCode).not.toBeChecked();
    expect(f.errors).toEqual([]);
  }finally{await f.clean();}
});

test('courier release and dispatcher assignment/block/unblock are usable on mobile and persist on the server',async({browser,request},info)=>{
  test.setTimeout(150000);const f=await fixture(request);
  try{
    const owner=await f.account('Клиент диспетчера'),courier=await f.account('Курьер до отказа'),replacement=await f.account('Курьер после смены'),admin=await f.account('Диспетчер Qadam');
    await f.approve(courier,admin);await f.approve(replacement,admin);await f.db.query('INSERT INTO qadam.administrators(user_id) VALUES($1)',[admin.user.id]);
    const created=await request.post('/api/orders',{headers:authenticated(owner),data:payload()}),order=(await created.json()).order;
    const courierPage=await f.page(browser,courier,`order=${order.id}`);await enableShiftGps(courierPage);await courierPage.getByRole('button',{name:'Принять заказ',exact:true}).click();
    await courierPage.getByRole('button',{name:'Отказаться до забора',exact:true}).click();await courierPage.getByLabel('Причина отказа',{exact:true}).fill('Не успеваю на место забора');await courierPage.getByRole('checkbox',{name:'Я ещё не забрал посылку',exact:true}).check();
    await courierPage.getByRole('heading',{name:'Вернуть заказ в поиск?',exact:true}).scrollIntoViewIfNeeded();await courierPage.screenshot({path:info.outputPath('courier-release-mobile.png')});await courierPage.getByRole('button',{name:'Вернуть в поиск',exact:true}).click();
    await expect.poll(async()=>((await request.get(`/api/orders/${order.id}`,{headers:authenticated(owner)})).json()).then(x=>x.order.status)).toBe('SEARCHING_FOR_COURIER');
    const adminPage=await f.page(browser,admin,`screen=adminOrders&order=${order.id}`);
    await adminPage.getByRole('button',{name:'Назначить курьера',exact:true}).click();await adminPage.getByLabel('Курьер',{exact:true}).selectOption(replacement.user.id);await adminPage.getByLabel('Причина действия',{exact:true}).fill('Назначение после отказа первого курьера');
    await adminPage.getByRole('heading',{name:'Управление заказом',exact:true}).scrollIntoViewIfNeeded();await noOverflow(adminPage);await adminPage.screenshot({path:info.outputPath('admin-dispatch-mobile.png')});
    await adminPage.getByRole('button',{name:'Подтвердить назначение',exact:true}).click();await expect(adminPage.getByRole('heading',{name:replacement.user.name,exact:true})).toBeVisible();
    expect((await request.get(`/api/orders/${order.id}`,{headers:authenticated(courier)})).status()).toBe(404);
    const replacementPage=await f.page(browser,replacement);await expect(replacementPage.getByRole('heading',{name:'Можно принять',exact:true})).toBeVisible();
    await adminPage.getByRole('button',{name:'Назад к списку заказов',exact:true}).click();await adminPage.getByRole('button',{name:'Назад в профиль',exact:true}).click();await adminPage.getByRole('button',{name:'Курьеры',exact:true}).click();
    const row=adminPage.locator('.courier-directory-row').filter({has:adminPage.getByRole('heading',{name:replacement.user.name,exact:true})});
    await row.getByRole('button',{name:'Ограничить курьерский доступ',exact:true}).click();await row.getByLabel('Причина решения',{exact:true}).fill('Уточняем сведения и связываемся с курьером');await row.getByRole('button',{name:'Ограничить доступ',exact:true}).click();
    await expect(row.getByText('Доступ ограничен',{exact:true})).toBeVisible();await expect(replacementPage.getByText('Курьерский доступ ограничен',{exact:true})).toBeVisible({timeout:25000});
    await row.scrollIntoViewIfNeeded();await adminPage.screenshot({path:info.outputPath('courier-block-mobile.png')});
    expect((await request.post(`/api/orders/${order.id}/status`,{headers:authenticated(replacement),data:{status:'PICKED_UP'}})).status()).toBe(403);
    expect((await request.get(`/api/admin/orders/${order.id}`,{headers:authenticated(admin)})).status()).toBe(200);
    await row.getByRole('button',{name:'Открыть курьерский доступ',exact:true}).click();await row.getByLabel('Причина решения',{exact:true}).fill('Проверка завершена, доступ восстановлен');await row.getByRole('button',{name:'Открыть доступ',exact:true}).click();await expect(row.getByText('Доступ открыт',{exact:true})).toBeVisible();
    const current=(await (await request.get(`/api/orders/${order.id}`,{headers:authenticated(owner)})).json()).order;expect(current.courierId).toBe(replacement.user.id);expect(current.status).toBe('ACCEPTED');
    expect(f.errors).toEqual([]);
  }finally{await f.clean();}
});
