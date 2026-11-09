'use client';

import type { TelegramWebApp } from './telegram-client';
import { contrast,validThemeColor } from './telegram-theme';

export const activeTelegram = () => typeof window !== 'undefined' && window.Telegram?.WebApp?.initData ? window.Telegram.WebApp : undefined;
export const telegramSupports = (app: TelegramWebApp | undefined, version: string) => !!app?.isVersionAtLeast?.(version);
export function haptic(type: 'selection' | 'success' | 'error') {
  const app=activeTelegram();
  if(!telegramSupports(app,'6.1'))return;
  try { if(type==='selection')app?.HapticFeedback?.selectionChanged();else app?.HapticFeedback?.notificationOccurred(type); } catch { /* Optional client feedback never changes an action result. */ }
}

let pendingConfirmation: Promise<boolean> | null=null;
let dismissConfirmation: (()=>void) | null=null;
export function cancelConfirmation(){dismissConfirmation?.();}
export function confirmAction(message: string): Promise<boolean> {
  if(pendingConfirmation)return pendingConfirmation;
  const app=activeTelegram();
  pendingConfirmation=new Promise<boolean>(resolve=>{
    let done=false;
    const finish=(value:boolean)=>{if(done)return;done=true;dismissConfirmation=null;resolve(value);};
    dismissConfirmation=()=>finish(false);
    if(app&&telegramSupports(app,'6.2')&&app.showConfirm){
      try {app.showConfirm(message,value=>finish(value===true));return;} catch { /* Use the accessible in-app dialog on unsupported clients. */ }
    }
    if(!app){finish(window.confirm(message));return;}
    const previous=document.activeElement;
    const dialog=document.createElement('dialog');dialog.className='qadam-confirm';dialog.setAttribute('aria-label','Подтверждение действия');
    let fallbackBackdrop:HTMLDivElement|undefined;
    const text=document.createElement('p');text.textContent=message;
    const actions=document.createElement('div');actions.className='qadam-confirm-actions';
    const no=document.createElement('button'),yes=document.createElement('button');
    no.type=yes.type='button';no.textContent='Отмена';yes.textContent='Подтвердить';no.className='button secondary';yes.className='button primary';
    const close=(value:boolean)=>{dialog.remove();fallbackBackdrop?.remove();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();finish(value);};
    dismissConfirmation=()=>close(false);no.onclick=()=>close(false);yes.onclick=()=>close(true);
    dialog.addEventListener('cancel',event=>{event.preventDefault();close(false);});
    dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close(false);}else if(event.key==='Tab'){event.preventDefault();(document.activeElement===no?yes:no).focus();}});
    actions.append(no,yes);dialog.append(text,actions);document.body.append(dialog);
    if(typeof dialog.showModal==='function')dialog.showModal();else {
      fallbackBackdrop=document.createElement('div');fallbackBackdrop.className='qadam-confirm-backdrop';
      dialog.classList.add('qadam-confirm-fallback');dialog.setAttribute('open','');dialog.setAttribute('role','alertdialog');dialog.setAttribute('aria-modal','true');
      fallbackBackdrop.append(dialog);document.body.append(fallbackBackdrop);
    }
    no.focus();
  }).finally(()=>{pendingConfirmation=null;});
  return pendingConfirmation;
}

// A single bridge consumes the same declared action footer and back button as
// the browser. It delegates to the real form/button instead of copying handlers.
export function bindTelegramControls(app: TelegramWebApp) {
  const main=app.MainButton,back=app.BackButton;
  const mainAvailable=!!main&&telegramSupports(app,'6.1')&&['setParams','onClick','offClick','show','hide','showProgress','hideProgress'].every(k=>typeof main[k as keyof typeof main]==='function');
  const backAvailable=!!back&&telegramSupports(app,'6.1')&&['onClick','offClick','show','hide'].every(k=>typeof back[k as keyof typeof back]==='function');
  document.documentElement.dataset.nativeBack=String(backAvailable);
  document.documentElement.dataset.nativeControls=String(backAvailable||mainAvailable);
  let mainTarget: HTMLButtonElement|null=null,backTarget: HTMLButtonElement|null=null,footer: HTMLElement|null=null;
  let timer:ReturnType<typeof setTimeout>|undefined,disposed=false,lastMain='';
  const unmark=()=>{mainTarget?.classList.remove('telegram-main-target');backTarget?.classList.remove('telegram-back-target');footer?.classList.remove('telegram-main-only');};
  function update(){
    if(disposed)return;
    if(!document.querySelector('.workspace')&&pendingConfirmation)cancelConfirmation();
    unmark();
    footer=document.querySelector<HTMLElement>('[data-telegram-actions]');
    const choices=footer?Array.from(footer.querySelectorAll<HTMLButtonElement>('button.button')).filter(b=>!b.hidden):[];
    mainTarget=choices.find(b=>b.classList.contains('primary'))??(choices.length===1?choices[0]:null);
    backTarget=document.querySelector<HTMLButtonElement>('[data-telegram-back="true"],[data-telegram-back=""]');
    if(mainAvailable&&mainTarget){
      const text=(mainTarget.textContent??'').replace(/\s+/g,' ').trim();
      if(text.length&&text.length<=64){
        const disabled=mainTarget.matches(':disabled');
        const progress=mainTarget.getAttribute('aria-busy')==='true'||(disabled&&/(?:…|\.\.\.)/.test(text));
        const styles=getComputedStyle(document.documentElement);
        const color=styles.getPropertyValue(mainTarget.classList.contains('danger')?'--danger':'--action').trim();
        const preferredText=styles.getPropertyValue('--button-text').trim();
        const textColor=validThemeColor(color)&&validThemeColor(preferredText)&&contrast(color,preferredText)<4.5?(contrast(color,'#ffffff')>contrast(color,'#000000')?'#ffffff':'#000000'):preferredText;
        const state=JSON.stringify([text,disabled,progress,color,textColor]);
        try {
          if(lastMain!==state){main!.setParams({text,is_visible:true,is_active:!disabled,...(validThemeColor(color)?{color}:{}),...(validThemeColor(textColor)?{text_color:textColor}:{})});if(progress)main!.showProgress(false);else main!.hideProgress();main!.show();lastMain=state;}
          mainTarget.classList.add('telegram-main-target');
          if(choices.length===1)footer?.classList.add('telegram-main-only');
        } catch {main!.hide();lastMain='';}
      }else {main!.hide();lastMain='';}
    }else if(mainAvailable){main!.hideProgress();main!.hide();lastMain='';}
    if(backAvailable){try{if(backTarget){back!.show();backTarget.classList.add('telegram-back-target');}else back!.hide();}catch{/* Own back stays available if a client rejects native controls. */}}
  }
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(update,0);};
  const pressMain=()=>{
    update();const button=mainTarget;
    if(!button?.isConnected||button.matches(':disabled')||pendingConfirmation||document.hidden||app.isActive===false)return;
    if(button.type==='submit'&&button.form)button.form.requestSubmit(button);else button.click();
    schedule();
  };
  const pressBack=()=>{update();if(pendingConfirmation){cancelConfirmation();return;}if(backTarget?.isConnected&&!backTarget.matches(':disabled')&&!document.hidden&&app.isActive!==false)backTarget.click();schedule();};
  if(mainAvailable)main!.onClick(pressMain);if(backAvailable)back!.onClick(pressBack);
  const observer=new MutationObserver(schedule);
  observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled','aria-busy']});
  window.addEventListener('qadam:theme-updated',schedule);update();
  return()=>{disposed=true;clearTimeout(timer);observer.disconnect();window.removeEventListener('qadam:theme-updated',schedule);unmark();cancelConfirmation();delete document.documentElement.dataset.nativeBack;delete document.documentElement.dataset.nativeControls;if(mainAvailable){main!.offClick(pressMain);main!.hideProgress();main!.hide();}if(backAvailable){back!.offClick(pressBack);back!.hide();}};
}
