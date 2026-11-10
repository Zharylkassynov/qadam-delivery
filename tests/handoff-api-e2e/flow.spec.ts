import {test} from '@playwright/test';
import {safeDeliveryBrowser} from '../handoff-browser-flow';
import {closeDatabase} from '../../src/lib/db';
test.afterAll(closeDatabase);
test('separate API enforces both handoffs with real persistence and the customer and courier interfaces',async({page,request,browser},info)=>{
  test.setTimeout(120000);await safeDeliveryBrowser({page,request,browser,info,apiOrigin:'http://127.0.0.1:3102',appOrigin:'http://127.0.0.1:3103'});
});
