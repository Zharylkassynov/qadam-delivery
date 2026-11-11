'use client';

import { createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode } from 'react';
import { api,ApiError } from '../lib/client-api';
import type { CourierStatus } from '../lib/courier-status';
import type { CourierLocation,User } from '../lib/types';
import { currentLocation,locationPermission,nativeLocationManager,type DeviceFix } from '../lib/device-location';
import { Button,Feedback,formatTime } from './delivery-ui';
import {locationConsentVersion,courierLocationConsent} from '../lib/location-consent';
import {RecipientSharingConsent} from './recipient-sharing';

type Phase='off'|'pending'|'live'|'permission'|'unavailable'|'network'|'paused';
type Presence={status:CourierStatus|null;busy:boolean;error:string;phase:Phase;geoError:string;saved:string|null;
  online:boolean;canAccept:boolean;wantsStart:boolean;cancelStart:()=>void;load:()=>Promise<void>;setOnline:(on:boolean)=>Promise<void>;enableLocation:(saveAuto?:boolean)=>Promise<void>;refreshLocation:()=>Promise<boolean>;saveSettings:(data:Record<string,unknown>)=>Promise<boolean>;retry:()=>void;openSettings:()=>void};
const Context=createContext<Presence|null>(null);
export const useCourierPresence=()=>{const value=useContext(Context);if(!value)throw new Error('Courier presence provider missing');return value;};
const foreground=()=>!document.hidden&&window.Telegram?.WebApp?.isActive!==false;

export function CourierPresenceProvider({user,children}:{user:User;children:ReactNode}) {
  const enabled=user.role==='COURIER';
  const [status,setStatus]=useState<CourierStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [phase,setPhase]=useState<Phase>('off'),[geoError,setGeoError]=useState(''),[saved,setSaved]=useState<string|null>(null);
  const [visible,setVisible]=useState(true),[tick,setTick]=useState(0),[version,setVersion]=useState(0);
  const [wantsStart,setWantsStart]=useState(false);
  const alive=useRef(true),saving=useRef(false),statusRevision=useRef(0),geoGeneration=useRef(0),consentBusy=useRef(false),lastPublish=useRef(-Infinity);
  const online=Boolean(enabled&&status?.online&&status.expiresAt&&Date.parse(status.expiresAt)>Date.now());
  const canAccept=Boolean(online&&phase==='live'&&status?.canAccept&&status.location&&Date.now()-Date.parse(status.location.capturedAt)<=90000&&Date.now()-Date.parse(status.location.receivedAt)<=90000);
  const load=useCallback(async()=>{
    if(!enabled||saving.current||!foreground())return;
    const current=statusRevision.current;
    try {const data=await api<{status:CourierStatus}>('/api/courier/status');if(alive.current&&current===statusRevision.current){setStatus(data.status);setSaved(data.status.location?.receivedAt??null);setError('');}}
    catch {if(alive.current)setError('Не удалось проверить статус. Повторите запрос.');}
  },[enabled]);
  useEffect(()=>{
    alive.current=true; if(!enabled)return()=>{alive.current=false;};
    const app=window.Telegram?.WebApp;
    const visibility=()=>{const active=foreground();if(!active)geoGeneration.current++;setVisible(active);setTick(n=>n+1);if(active)void load();};
    const deactivate=()=>{geoGeneration.current++;setVisible(false);};
    const activate=()=>{setVisible(!document.hidden);setVersion(n=>n+1);void load();};
    const timer=setInterval(()=>{setTick(n=>n+1);void load();},15000);
    document.addEventListener('visibilitychange',visibility);window.addEventListener('focus',visibility);window.addEventListener('pagehide',deactivate);
    app?.onEvent?.('deactivated',deactivate);app?.onEvent?.('activated',activate);app?.onEvent?.('locationManagerUpdated',activate);
    void load();
    return()=>{alive.current=false;geoGeneration.current++;clearInterval(timer);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('focus',visibility);window.removeEventListener('pagehide',deactivate);app?.offEvent?.('deactivated',deactivate);app?.offEvent?.('activated',activate);app?.offEvent?.('locationManagerUpdated',activate);};
  },[enabled,load]);

  useEffect(()=>{
    if(consentBusy.current)return;
    if(!enabled||!online||!status?.locationSharing){geoGeneration.current++;setPhase(previous=>wantsStart&&['permission','unavailable','network'].includes(previous)?previous:'off');return;}
    if(!visible){setPhase('paused');return;}
    const generation=++geoGeneration.current;let stopped=false,pending=false,latest:DeviceFix|undefined;
    let watch:number|undefined,timer:ReturnType<typeof setInterval>|undefined;
    const controller=new AbortController();
    const current=()=>!stopped&&generation===geoGeneration.current&&foreground();
    async function send() {
      if(!current()||pending||performance.now()-lastPublish.current<14500)return;
      pending=true;lastPublish.current=performance.now();
      try {
        const fix=latest&&Date.now()-Date.parse(latest.capturedAt)<20000?latest:await currentLocation();
        if(!current())return;
        const data=await api<{location:CourierLocation}>('/api/courier/location',fix,controller.signal);
        if(current()){setSaved(data.location.receivedAt);setPhase('live');setGeoError('');void load();}
      } catch(e) {
        if(!current())return;
        if(e instanceof ApiError&&e.status===429){setPhase('live');setGeoError('');void load();return;}
        setGeoError(e instanceof Error?e.message:'Не удалось передать позицию.');
        const access=e instanceof ApiError&&(e.status===403||e.status===409);
        setPhase(e instanceof ApiError?'network':'permission');
        if(access){stopped=true;void load();}
        if(!(e instanceof ApiError)){stopped=true;clearInterval(timer);if(watch!==undefined)navigator.geolocation.clearWatch(watch);}
      } finally {pending=false;}
    }
    void (async()=>{
      try {
        const permission=await locationPermission();if(!current())return;
        if(permission!=='granted'){setPhase(permission==='unavailable'?'unavailable':'permission');return;}
        setPhase(saved&&Date.now()-Date.parse(saved)<90000?'live':'pending');setGeoError('');
        if(!nativeLocationManager()&&navigator.geolocation?.watchPosition){
          watch=navigator.geolocation.watchPosition(p=>{latest={latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,capturedAt:new Date(p.timestamp).toISOString()};},()=>{}, {enableHighAccuracy:true,maximumAge:0,timeout:12000});
        }
        void send();timer=setInterval(()=>void send(),15000);
      } catch {if(current()){setPhase('unavailable');setGeoError('Не удалось проверить геолокацию. Повторите запрос.');}}
    })();
    return()=>{stopped=true;controller.abort();clearInterval(timer);if(watch!==undefined)navigator.geolocation.clearWatch(watch);};
    // A refreshed status object must never restart GPS or reset its pacing.
  },[enabled,online,status?.locationSharing,visible,version,wantsStart,load]);

  async function setOnline(on:boolean){
    if(saving.current)return;
    if(on&&(!status?.consentCurrent||!status.autoLocationEnabled)){setWantsStart(true);return;}
    saving.current=true;statusRevision.current++;setBusy(true);setError('');
    try {const data=await api<{status:CourierStatus}>('/api/courier/status',{online:on});if(alive.current){setStatus(data.status);setSaved(data.status.location?.receivedAt??null);setWantsStart(false);if(!data.status.location)lastPublish.current=-Infinity;if(!data.status.online){geoGeneration.current++;setPhase('off');}setVersion(v=>v+1);}}
    catch {if(alive.current){setError('Не удалось сохранить статус. Предыдущее состояние сохранено.');setVersion(v=>v+1);}}
    finally {saving.current=false;if(alive.current)setBusy(false);}
  }
  async function enableLocation(saveAuto=false){
    if(consentBusy.current||saving.current||!foreground())return;
    consentBusy.current=true;setBusy(true);setGeoError('');const generation=++geoGeneration.current;
    try {
      // Invoke the native permission request directly from the click, before HTTP awaits.
      const fix=await currentLocation();
      if(generation!==geoGeneration.current||!alive.current||!foreground())return;
      if(saveAuto)await api('/api/courier/location-preferences',{autoEnabled:true,consentVersion:locationConsentVersion});
      if(!online||(!status?.acceptingOrders&&!status?.endingAfterDelivery))await api('/api/courier/status',{online:true});
      await api('/api/courier/location',{sharing:true,consent:true});
      if(generation!==geoGeneration.current||!alive.current||!foreground())return;
      const data=await api<{location:CourierLocation}>('/api/courier/location',fix);
      if(alive.current){lastPublish.current=performance.now();setSaved(data.location.receivedAt);setPhase('live');setWantsStart(false);}
    } catch(e) {if(alive.current){setPhase(e instanceof ApiError?'network':'permission');setGeoError(e instanceof Error?e.message:'Не удалось включить геолокацию.');}}
    finally {consentBusy.current=false;if(alive.current){setBusy(false);await load();setVersion(v=>v+1);}}
  }
  async function refreshLocation(){
    if(consentBusy.current||saving.current||!foreground()||!online||!status?.locationSharing||!status.consentCurrent)return false;
    consentBusy.current=true;setBusy(true);setGeoError('');const generation=++geoGeneration.current;
    try{
      // Read on the click so Telegram can request device access immediately.
      const fix=await currentLocation();
      if(generation!==geoGeneration.current||!alive.current||!foreground())return false;
      const data=await api<{location:CourierLocation}>('/api/courier/location',fix);
      if(generation!==geoGeneration.current||!alive.current||!foreground())return false;
      lastPublish.current=performance.now();setSaved(data.location.receivedAt);setPhase('live');return true;
    }catch(e){
      if(alive.current&&generation===geoGeneration.current){
        if(e instanceof ApiError&&e.status===429){setPhase('live');return true;}
        setPhase(e instanceof ApiError?'network':'permission');setGeoError(e instanceof Error?e.message:'Не удалось обновить позицию.');
      }
      return false;
    }finally{consentBusy.current=false;if(alive.current){setBusy(false);await load();setVersion(v=>v+1);}}
  }
  const retry=()=>{setVersion(v=>v+1);void load();};
  async function saveSettings(data:Record<string,unknown>){
    if(saving.current)return false;
    saving.current=true;statusRevision.current++;if(data.revoke)geoGeneration.current++;setBusy(true);setError('');
    try{await api('/api/courier/location-preferences',data);if(data.revoke){setGeoError('');setWantsStart(false);}return true;}
    catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить настройку.');return false;}
    finally{saving.current=false;setBusy(false);await load();setVersion(v=>v+1);}
  }
  const openSettings=()=>{const manager=nativeLocationManager();if(manager)manager.openSettings();else{setGeoError('Разрешите геолокацию в настройках сайта, затем нажмите «Повторить геолокацию».');}};
  // tick updates expiry even when a status request fails.
  void tick;
  return <Context.Provider value={{status,busy,error,phase,geoError,saved,online,canAccept,wantsStart,cancelStart:()=>setWantsStart(false),load,setOnline,enableLocation,refreshLocation,saveSettings,retry,openSettings}}>{children}</Context.Provider>;
}

export function CourierGpsContent({compact=false}:{compact?:boolean}){
  const geo=useCourierPresence(),[consent,setConsent]=useState(false);
  useEffect(()=>{if(!geo.wantsStart||geo.status?.consentCurrent)setConsent(false);},[geo.wantsStart,geo.status?.consentCurrent]);
  if(!geo.status)return <div className="courier-gps" role="status"><strong>Проверяем геопозицию…</strong></div>;
  if(!geo.online&&!geo.wantsStart)return <div className="courier-gps"><p>Для новых заказов включите смену и передайте свежую геопозицию.</p><button className="button primary wide" disabled={geo.busy||!geo.status} onClick={()=>void geo.setOnline(true)}>Выйти на линию</button></div>;
  if(!geo.status?.consentCurrent||geo.wantsStart)return <div className="courier-gps geo-consent"><h2>Геопозиция нужна для заказов</h2><p>Свободным клиентам показываем примерное расположение. Клиенту вашего заказа — позицию и время обновления. Профиль, история и текущая доставка доступны без разрешения.</p><label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>{courierLocationConsent}</span></label><p>При сохранённом разрешении передача запускается автоматически в открытом Qadam. Для внешнего навигатора трансляция Telegram подключается отдельно. <a href="/privacy" target="_blank" rel="noopener noreferrer">Как используется геопозиция</a></p>{geo.geoError&&<p className="gps-error" role="alert">{geo.geoError}</p>}<button className="button primary wide" disabled={!consent||geo.busy} onClick={()=>void geo.enableLocation(true)}>{geo.busy?'Получаем позицию…':'Разрешить геопозицию'}</button>{!geo.online&&<button className="text-button" disabled={geo.busy} onClick={geo.cancelStart}>Пока не выходить на линию</button>}</div>;
  const title=geo.phase==='live'&&geo.saved&&Date.now()-Date.parse(geo.saved)>90000?'Геопозиция устарела':{off:'Геолокация готова к включению',pending:'Получаем вашу позицию…',live:'Позиция передаётся',permission:'Геолокация не разрешена',unavailable:'Геолокация недоступна',network:'Позиция не отправлена',paused:'Передача позиции приостановлена'}[geo.phase];
  if(compact)return <div className="courier-gps gps-compact" role="status"><strong>{title}</strong><p>{geo.geoError||'Для принятия нужна свежая позиция.'}</p>{['permission','unavailable','off'].includes(geo.phase)||!geo.status.locationSharing?<><button type="button" className="text-button" disabled={geo.busy} onClick={()=>void geo.enableLocation()}>Повторить геолокацию</button><button type="button" className="text-button" onClick={geo.openSettings}>Открыть настройки геолокации</button></>:geo.phase!=='pending'&&<button type="button" className="text-button" disabled={geo.busy} onClick={()=>void geo.refreshLocation()}>Обновить позицию</button>}</div>;
  return <div className={`courier-gps ${geo.phase==='live'?'gps-live':['permission','unavailable','network'].includes(geo.phase)?'gps-warning':''}`} role="status"><strong>{title}</strong>
    <p>{geo.phase==='live'&&geo.saved?`Позиция сохранена: ${formatTime(geo.saved)}. ${geo.canAccept?'Можно переходить между экранами.':'Проверьте свежесть позиции и состояние приёма новых заказов.'}`:geo.phase==='paused'?'Qadam свёрнут. После возвращения передача продолжится автоматически.':geo.phase==='network'?'Нет связи с сервером. Повторим отправку автоматически.':geo.phase==='permission'?'Разрешите доступ в Telegram или настройках телефона. Новые заказы пока недоступны.':geo.phase==='pending'?'Приём откроется после получения свежей позиции сервером.':'Проверьте геолокацию устройства. Новые заказы пока недоступны.'}</p>
    {!geo.canAccept&&!geo.status?.endingAfterDelivery&&<p>Новые заказы недоступны до получения свежей позиции.{!!geo.status?.activeDeliveries&&' Ваша доставка остаётся у вас. Клиент видит время последней точки.'}</p>}
    {geo.geoError&&<p className="gps-error">{geo.geoError}</p>}
    {(['permission','unavailable','off'].includes(geo.phase)||!geo.status?.locationSharing)&&<><button className="text-button" disabled={geo.busy} onClick={geo.openSettings}>Открыть настройки геолокации</button><button className="text-button" disabled={geo.busy} onClick={()=>void geo.enableLocation()}>Повторить геолокацию</button></>}
    {geo.phase==='network'&&<button className="text-button" disabled={geo.busy} onClick={geo.retry}>Повторить отправку</button>}
  </div>;
}

export function CourierGpsStatus({hideContent=false}:{hideContent?:boolean}){
  const geo=useCourierPresence(),[open,setOpen]=useState(false),[notice,setNotice]=useState('');
  return <>{!hideContent&&<CourierGpsContent/>}{geo.geoError&&['permission','unavailable'].includes(geo.phase)&&(!geo.status?.consentCurrent||geo.wantsStart)&&<button type="button" className="text-button" disabled={geo.busy} onClick={geo.openSettings}>Открыть настройки геолокации</button>}<div className="trust-section courier-gps-settings">
    {geo.online&&geo.status?.acceptingOrders&&geo.status.activeDeliveries>0&&<Button variant="secondary" disabled={geo.busy} onClick={()=>void geo.setOnline(false)}>Закончить после доставки</Button>}
    {geo.status?.endingAfterDelivery&&<Feedback title="Приём новых выключен">Геопозиция используется для текущих доставок. После последней доставки смена завершится. Можно остановить использование раньше, отозвав согласие.</Feedback>}
    {!open?<Button variant="ghost" disabled={geo.busy} onClick={()=>{setOpen(true);setNotice('');}}>Настройки геолокации</Button>:<>
      <h2>Геолокация курьера</h2><p className="muted">{geo.status?.consentCurrent?'Использование разрешено во время смены и активных доставок.':'Обновлённые условия ещё не подтверждены.'} Полная история перемещений не собирается.</p>
      <p className="muted">После отзыва новые заказы недоступны. Уже принятая доставка сохраняется. Разрешения телефона и трансляция в чате Telegram управляются отдельно.</p>
      {geo.error&&<Feedback title={geo.error} tone="error" role="alert"/>}
      <Button variant="secondary" disabled={geo.busy} onClick={()=>void geo.saveSettings({revoke:true}).then(ok=>{if(ok){setOpen(false);setNotice('Передача в Qadam остановлена. Остановите трансляцию также в чате Telegram.');}})}>Отозвать согласие и остановить</Button>
      <Button variant="ghost" disabled={geo.busy} onClick={()=>setOpen(false)}>Закрыть настройки</Button>
      <RecipientSharingConsent/>
    </>}{notice&&<p role="status">{notice}</p>}
  </div></>;
}
