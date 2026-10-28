'use client';

import { createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode } from 'react';
import { api,ApiError } from '../lib/client-api';
import type { CourierStatus } from '../lib/courier-status';
import type { CourierLocation,User } from '../lib/types';
import { currentLocation,locationPermission,nativeLocationManager,type DeviceFix } from '../lib/device-location';
import { formatTime } from './delivery-ui';

type Phase='off'|'pending'|'live'|'permission'|'unavailable'|'network'|'paused';
type Presence={status:CourierStatus|null;busy:boolean;error:string;phase:Phase;geoError:string;saved:string|null;
  online:boolean;load:()=>Promise<void>;setOnline:(on:boolean)=>Promise<void>;enableLocation:()=>Promise<void>;retry:()=>void;openSettings:()=>void};
const Context=createContext<Presence|null>(null);
export const useCourierPresence=()=>{const value=useContext(Context);if(!value)throw new Error('Courier presence provider missing');return value;};
const foreground=()=>!document.hidden&&window.Telegram?.WebApp?.isActive!==false;

export function CourierPresenceProvider({user,children}:{user:User;children:ReactNode}) {
  const enabled=user.role==='COURIER';
  const [status,setStatus]=useState<CourierStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [phase,setPhase]=useState<Phase>('off'),[geoError,setGeoError]=useState(''),[saved,setSaved]=useState<string|null>(null);
  const [visible,setVisible]=useState(true),[tick,setTick]=useState(0),[version,setVersion]=useState(0);
  const alive=useRef(true),saving=useRef(false),statusRevision=useRef(0),geoGeneration=useRef(0),consentBusy=useRef(false);
  const online=Boolean(enabled&&status?.online&&status.expiresAt&&Date.parse(status.expiresAt)>Date.now());
  const load=useCallback(async()=>{
    if(!enabled||saving.current||!foreground())return;
    const current=statusRevision.current;
    try {const data=await api<{status:CourierStatus}>('/api/courier/status');if(alive.current&&current===statusRevision.current){setStatus(data.status);if(data.status.location)setSaved(data.status.location.receivedAt);setError('');}}
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
    if(!enabled||!online||!status?.locationSharing){geoGeneration.current++;setPhase('off');return;}
    if(!visible){setPhase('paused');return;}
    const generation=++geoGeneration.current;let stopped=false,pending=false,lastSent=saved?Date.parse(saved):0,latest:DeviceFix|undefined;
    let watch:number|undefined,timer:ReturnType<typeof setInterval>|undefined;
    const controller=new AbortController();
    const current=()=>!stopped&&generation===geoGeneration.current&&foreground();
    async function send() {
      if(!current()||pending||Date.now()-lastSent<14500)return;
      pending=true;lastSent=Date.now();
      try {
        const fix=latest&&Date.now()-Date.parse(latest.capturedAt)<20000?latest:await currentLocation();
        if(!current())return;
        const data=await api<{location:CourierLocation}>('/api/courier/location',fix,controller.signal);
        if(current()){setSaved(data.location.receivedAt);setPhase('live');setGeoError('');}
      } catch(e) {
        if(!current())return;
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
        setPhase(Date.now()-lastSent<20000?'live':'pending');setGeoError('');
        if(!nativeLocationManager()&&navigator.geolocation?.watchPosition){
          watch=navigator.geolocation.watchPosition(p=>{latest={latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,capturedAt:new Date(p.timestamp).toISOString()};},()=>{}, {enableHighAccuracy:true,maximumAge:0,timeout:12000});
        }
        void send();timer=setInterval(()=>void send(),15000);
      } catch {if(current()){setPhase('unavailable');setGeoError('Не удалось проверить геолокацию. Повторите запрос.');}}
    })();
    return()=>{stopped=true;controller.abort();clearInterval(timer);if(watch!==undefined)navigator.geolocation.clearWatch(watch);};
    // A refreshed status object must never restart GPS or reset its pacing.
  },[enabled,online,status?.locationSharing,visible,version,load]);

  async function setOnline(on:boolean){
    if(saving.current)return;
    saving.current=true;statusRevision.current++;setBusy(true);setError('');
    if(!on)geoGeneration.current++;
    try {const data=await api<{status:CourierStatus}>('/api/courier/status',{online:on});if(alive.current){setStatus(data.status);if(!on)setPhase('off');else setVersion(v=>v+1);}}
    catch {if(alive.current){setError('Не удалось сохранить статус. Предыдущее состояние сохранено.');setVersion(v=>v+1);}}
    finally {saving.current=false;if(alive.current)setBusy(false);}
  }
  async function enableLocation(){
    if(consentBusy.current||saving.current||!foreground())return;
    consentBusy.current=true;setBusy(true);setGeoError('');const generation=++geoGeneration.current;
    try {
      await api('/api/courier/location',{sharing:true,consent:true});
      if(generation!==geoGeneration.current||!alive.current||!foreground())return;
      const fix=await currentLocation();
      if(generation!==geoGeneration.current||!alive.current||!foreground())return;
      const data=await api<{location:CourierLocation}>('/api/courier/location',fix);
      if(alive.current){setSaved(data.location.receivedAt);setPhase('live');}
    } catch(e) {if(alive.current){setPhase(e instanceof ApiError?'network':'permission');setGeoError(e instanceof Error?e.message:'Не удалось включить геолокацию.');}}
    finally {consentBusy.current=false;if(alive.current){setBusy(false);await load();setVersion(v=>v+1);}}
  }
  const retry=()=>{setVersion(v=>v+1);void load();};
  const openSettings=()=>{const manager=nativeLocationManager();if(manager)manager.openSettings();else{setGeoError('Разрешите геолокацию в настройках сайта, затем нажмите «Повторить геолокацию».');}};
  // tick updates expiry even when a status request fails.
  void tick;
  return <Context.Provider value={{status,busy,error,phase,geoError,saved,online,load,setOnline,enableLocation,retry,openSettings}}>{children}</Context.Provider>;
}

export function CourierGpsStatus(){
  const geo=useCourierPresence(),[consent,setConsent]=useState(false);
  if(!geo.online)return <div className="courier-gps"><p>Для автоматической передачи позиции включите «Я на линии».</p><button className="text-button" disabled={geo.busy} onClick={()=>void geo.setOnline(true)}>Включить смену</button></div>;
  if(!geo.status?.locationSharing)return <div className="courier-gps geo-consent"><p>Свободным клиентам показываем примерное расположение. Клиенту вашего заказа — GPS-позицию с точностью устройства.</p><label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>Разрешаю показывать мою позицию во время смены.</span></label><button className="button primary wide" disabled={!consent||geo.busy} onClick={()=>void geo.enableLocation()}>{geo.busy?'Получаем позицию…':'Разрешить геолокацию'}</button></div>;
  const title={off:'Геолокация готова к включению',pending:'Получаем вашу позицию…',live:'Позиция передаётся',permission:'Геолокация не разрешена',unavailable:'Геолокация недоступна',network:'Позиция не отправлена',paused:'Передача позиции приостановлена'}[geo.phase];
  return <div className={`courier-gps ${['permission','unavailable','network'].includes(geo.phase)?'gps-warning':''}`} role="status"><strong>{title}</strong>
    <p>{geo.phase==='live'&&geo.saved?`Позиция сохранена: ${formatTime(geo.saved)}. Можно переходить между экранами.`:geo.phase==='paused'?'Qadam свёрнут. После возвращения передача продолжится автоматически.':geo.phase==='network'?'Нет связи с сервером. Повторим отправку автоматически.':geo.phase==='permission'?'Заказы доступны, но клиенты пока не видят вас на общей карте.':geo.phase==='pending'?'Как только устройство определит местоположение, вы появитесь на карте.':'Проверьте геолокацию устройства. Заказы остаются доступны.'}</p>
    {geo.geoError&&<p className="gps-error">{geo.geoError}</p>}
    {['permission','unavailable'].includes(geo.phase)&&<><button className="text-button" disabled={geo.busy} onClick={geo.openSettings}>Открыть настройки геолокации</button><button className="text-button" disabled={geo.busy} onClick={()=>void geo.enableLocation()}>Повторить геолокацию</button></>}
    {geo.phase==='network'&&<button className="text-button" disabled={geo.busy} onClick={geo.retry}>Повторить отправку</button>}
  </div>;
}
