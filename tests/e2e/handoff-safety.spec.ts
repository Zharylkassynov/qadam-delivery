import {test} from '@playwright/test';
import {safeDeliveryBrowser} from '../handoff-browser-flow';
import {closeDatabase} from '../../src/lib/db';
test.use({viewport:{width:390,height:844}});
test.skip(Boolean(process.env.E2E_ORIGIN),'Local synthetic identities only');
test.afterAll(closeDatabase);
test('mandatory pickup and dropoff use GPS and separate owner codes through native Telegram controls',async({page,request,browser},info)=>{
  test.setTimeout(120000);await safeDeliveryBrowser({page,request,browser,info,apiOrigin:'http://127.0.0.1:3105',appOrigin:'http://127.0.0.1:3105'});
});
