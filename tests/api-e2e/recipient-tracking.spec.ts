import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
const api='http://127.0.0.1:3102',origin='http://127.0.0.1:3103';
test('recipient opens standalone frontend without Telegram; public API CORS allows only tracking credential',async({page,playwright,request})=>{
  const owner=await playwright.request.newContext({baseURL:api,extraHTTPHeaders:{Origin:origin}});
  try{
    expect((await owner.post('/api/auth/login',{data:{email:'customer1@qadam.demo',password:process.env.DEMO_PASSWORD}})).status()).toBe(200);
    const created=await owner.post('/api/orders',{data:{requestKey:randomUUID(),pickupAddress:'Адрес отдельного API 123',destinationAddress:'Закрытый адрес доставки 456',recipientName:'Закрытый получатель',recipientPhone:'+77000000000',notes:'Закрытое примечание'}});expect(created.status()).toBe(201);const order=(await created.json()).order;
    const linkResponse=await owner.post(`/api/orders/${order.id}/recipient-link`,{data:{action:'create'}});expect(linkResponse.status()).toBe(200);const {link}=await linkResponse.json(),token=new URL(link.url).pathname.split('/').at(-1)!;
    expect(new URL(link.url).origin).toBe(origin);
    const preflight=await request.fetch(`${api}/api/recipient-tracking`,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'x-qadam-tracking'}});expect(preflight.status()).toBe(204);
    const forbidden=await request.fetch(`${api}/api/orders`,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'x-qadam-tracking'}});expect(forbidden.status()).toBe(403);
    const response=await request.get(`${api}/api/recipient-tracking`,{headers:{Origin:origin,'X-Qadam-Tracking':token}});expect(response.status()).toBe(200);expect(response.headers()['access-control-allow-origin']).toBe(origin);expect(JSON.stringify(await response.json())).not.toContain(order.id);
    const sdk:string[]=[];page.on('request',r=>{if(r.url().includes('telegram.org'))sdk.push(r.url());});await page.goto(link.url);await expect(page.getByText('Ищем курьера',{exact:true}).first()).toBeVisible();expect(sdk).toEqual([]);await expect(page.getByRole('textbox',{name:'Логин',exact:true})).toHaveCount(0);
    await owner.post(`/api/orders/${order.id}/recipient-link`,{data:{action:'revoke'}});await page.reload();await expect(page.getByRole('heading',{name:'Ссылка недоступна',exact:true})).toBeVisible();
  }finally{await owner.dispose();}
});
