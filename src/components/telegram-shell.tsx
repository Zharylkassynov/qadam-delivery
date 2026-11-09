'use client';

import { useEffect, useState } from 'react';
import { activeTelegram, bindTelegramControls, haptic, telegramSupports } from '../lib/telegram-ui';
import { telegramPalette } from '../lib/telegram-theme';
import { Button } from './delivery-ui';

export function TelegramShell({ recipient=false }: { recipient?:boolean }) {
  useEffect(()=>{
    const media=window.matchMedia('(prefers-color-scheme: dark)');
    let removeControls:(()=>void)|undefined,removeTheme:(()=>void)|undefined;
    const theme=()=>{
      const app=recipient?undefined:activeTelegram();
      const dark=app?.colorScheme?app.colorScheme==='dark':media.matches;
      const palette=telegramPalette(dark,app?.themeParams);
      document.documentElement.dataset.colorScheme=dark?'dark':'light';
      document.documentElement.style.colorScheme=dark?'dark':'light';
      for(const [key,value] of Object.entries(palette))document.documentElement.style.setProperty(`--${key}`,value);
      try {app?.setHeaderColor?.(palette.surface);app?.setBackgroundColor?.(palette.surface);}catch{/* Old clients keep their own header. */}
      window.dispatchEvent(new Event('qadam:theme-updated'));
    };
    const connect=()=>{
      removeControls?.();removeTheme?.();
      const app=recipient?undefined:activeTelegram();theme();
      if(app){removeControls=bindTelegramControls(app);app.onEvent?.('themeChanged',theme);removeTheme=()=>app.offEvent?.('themeChanged',theme);}
    };
    const selection=(event:Event)=>{const target=event.target;if(!recipient&&target instanceof Element&&target.closest('button[aria-pressed],.address-picker-result,[data-haptic-selection]'))haptic('selection');};
    connect();media.addEventListener('change',theme);window.addEventListener('qadam:telegram-ready',connect);document.addEventListener('click',selection);
    return()=>{removeControls?.();removeTheme?.();media.removeEventListener('change',theme);window.removeEventListener('qadam:telegram-ready',connect);document.removeEventListener('click',selection);};
  },[recipient]);
  return null;
}

export function CourierHomeScreen() {
  const [status,setStatus]=useState<'unsupported'|'unknown'|'added'|'missed'|null>(null);
  const [notice,setNotice]=useState('');
  useEffect(()=>{
    const app=activeTelegram();let alive=true;
    if(!telegramSupports(app,'8.0')||!app?.addToHomeScreen||!app.checkHomeScreenStatus)return;
    const added=()=>{if(alive){setStatus('added');setNotice('');}};
    app.onEvent?.('homeScreenAdded',added);
    try{app.checkHomeScreenStatus(value=>{if(alive&&['unsupported','unknown','added','missed'].includes(value))setStatus(value);});}catch{setStatus('unsupported');}
    return()=>{alive=false;app.offEvent?.('homeScreenAdded',added);};
  },[]);
  if(!status||status==='unsupported')return null;
  return <section className="home-screen-shortcut"><h2>Qadam под рукой</h2><p className="muted">Открывайте Qadam с главного экрана телефона.</p>
    {status==='added'?<p role="status">Ярлык уже добавлен</p>:<Button variant="secondary" onClick={()=>{try{activeTelegram()?.addToHomeScreen?.();setNotice('Следуйте подсказкам Telegram.');}catch{setNotice('Не удалось открыть подсказку. Повторите попытку.');}}}>Добавить на главный экран</Button>}
    {notice&&<p role="status" className="muted">{notice}</p>}
    <p className="field-hint">Ярлык открывает Mini App. Новые точки поступают, пока Qadam открыт и геолокация разрешена.</p>
  </section>;
}
