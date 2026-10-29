'use client';
import { useEffect,useRef,useState } from 'react';
import { api } from '../lib/client-api';
import { telegramApp } from '../lib/telegram-client';
import type { PhoneProfile } from '../lib/user-profiles';
import { Feedback } from './delivery-ui';

export function usePhoneProfile(enabled:boolean){
  const [profile,setProfile]=useState<PhoneProfile>({phone:null,phoneVerified:false,verifiedAt:null});
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const alive=useRef(false),pending=useRef(false);
  useEffect(()=>{
    alive.current=true;if(!enabled)return()=>{alive.current=false;};
    const controller=new AbortController();let loading=false;
    const load=async()=>{if(loading||document.hidden)return;loading=true;try{const data=await api<PhoneProfile>('/api/phone-profile',undefined,controller.signal);if(!controller.signal.aborted)setProfile(data);}catch{/* A profile lookup must not block old/manual orders. */}finally{loading=false;}};
    void load();const timer=setInterval(()=>void load(),15000);
    return()=>{alive.current=false;controller.abort();clearInterval(timer);};
  },[enabled]);
  async function request(){
    if(pending.current)return;pending.current=true;setBusy(true);setNotice('');
    try{
      const before=(await api<PhoneProfile>('/api/phone-profile')).verifiedAt;
      const app=await telegramApp();
      if(!app?.requestContact){setNotice('Откройте Qadam в обновлённом Telegram, чтобы передать свой номер.');return;}
      const shared=await new Promise<boolean>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('timeout')),30000);app.requestContact!(value=>{clearTimeout(timer);resolve(value);});});
      if(!alive.current)return;
      if(!shared){setNotice('Номер не передан. Можно попробовать снова или вернуться к заказу.');return;}
      for(let n=0;n<12&&alive.current;n++){
        const data=await api<PhoneProfile>('/api/phone-profile');
        if(!alive.current)return;setProfile(data);
        if(data.phoneVerified&&data.phone&&data.verifiedAt!==before){setNotice('');return;}
        await new Promise(resolve=>setTimeout(resolve,700));
      }
      if(alive.current)setNotice('Подтверждение ещё не получено. Повторите попытку немного позже.');
    }catch{if(alive.current)setNotice('Не удалось подтвердить номер. Повторите попытку.');}
    finally{pending.current=false;if(alive.current)setBusy(false);}
  }
  return {profile,busy,notice,request};
}
export function PhoneProfilePanel({profile,busy,notice}:{profile:PhoneProfile;busy:boolean;notice:string}){
  return <section className="form-fields"><div className="screen-heading"><h1 tabIndex={-1}>Телефон для связи</h1><p>Номер из вашего аккаунта Telegram</p></div>
    {profile.phoneVerified?<Feedback title="Номер получен из Telegram" tone="success"><p className="phone-number">{profile.phone}</p><p>Номер доступен участнику вашей доставки после назначения курьера.</p></Feedback>:<><p>Разрешите Telegram передать ваш номер Qadam, чтобы участники доставки могли связаться с вами.</p><Feedback title="Кому виден номер">После принятия заказа — вашему курьеру или клиенту, а также администраторам сервиса. На общей карте номер не показывается.</Feedback><p className="muted">Нажимая «Поделиться номером», вы разрешаете его получение из Telegram и показ участникам вашего заказа после назначения.</p></>}
    {busy&&<Feedback title="Проверяем номер из Telegram…" role="status">Дождитесь подтверждения сервера. Разрешение в окне Telegram само по себе ещё не подтверждает номер.</Feedback>}
    {notice&&<p role="status" className="muted">{notice}</p>}
  </section>;
}
