import { expect,type Locator,type Page } from '@playwright/test';

export async function expectPhoneCall(page:Page,link:Locator,href:string){
  await expect(link).toHaveAttribute('href',href);
  await expect(link).toHaveAttribute('target','_blank');
  await expect(link).toHaveAttribute('rel','noopener noreferrer');
  // Record a real tap's external navigation contract. Never call a phone number
  // or invoke the host machine's dialer from a browser test.
  await link.evaluate(element=>element.addEventListener('click',event=>{
    event.preventDefault();
    const anchor=element as HTMLAnchorElement;
    document.documentElement.dataset.phoneCall=JSON.stringify({href:anchor.href,target:anchor.target});
  },{once:true}));
  await link.click();
  await expect(page.locator('html')).toHaveAttribute('data-phone-call',JSON.stringify({href,target:'_blank'}));
}
