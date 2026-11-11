'use client';

import { useRef } from 'react';
import { serviceTimezone } from '../lib/service-area';
import { useTelegramProfile } from './telegram-permissions';
import { CourierGpsContent,CourierGpsStatus,useCourierPresence } from './courier-presence';
import { formatTime } from './delivery-ui';

export function CourierAvailability({telegram,settings=true}:{telegram:boolean;settings?:boolean}) {
  const geo=useCourierPresence(),permissions=useTelegramProfile(telegram,15000),retry=useRef<boolean|null>(null);
  const {status,online,busy,error}=geo;
  const accepting=online&&!!status?.acceptingOrders;
  const time=status?.expiresAt?new Intl.DateTimeFormat('ru-KZ',{hour:'2-digit',minute:'2-digit',timeZone:serviceTimezone}).format(new Date(status.expiresAt)):'';
  async function save(value:boolean){retry.current=value;await geo.setOnline(value);}
  const label=busy?'Сохраняем…':!status?'Проверяем статус…':status.endingAfterDelivery?'Завершаем смену':geo.canAccept?'На линии':online?'Проверяем геопозицию':'Не на линии';
  return <section className={`courier-shift compact-shift ${geo.canAccept?'is-online':''}`} aria-label="Готовность к заказам" aria-busy={busy}>
    <div className="availability-row"><strong role="status" aria-label={geo.canAccept?'Можно принимать заказы':undefined}><span className="availability-dot"/>{label}</strong>
      <button type="button" className="availability-switch" role="switch" aria-label="Я на линии" aria-checked={accepting} disabled={!status||busy} onClick={()=>void save(!accepting)}><span/></button></div>
    {status?.expired&&!online&&!geo.wantsStart&&<p className="availability-hint">Смена завершилась. Включите, когда будете готовы.</p>}
    {status?.endingAfterDelivery&&<p className="availability-hint">Новые заказы выключены. Текущая доставка остаётся у вас.</p>}
    {(geo.wantsStart||(online&&!geo.canAccept&&!status?.endingAfterDelivery))&&<CourierGpsContent compact/>}
    {geo.geoError&&['permission','unavailable'].includes(geo.phase)&&(!status?.consentCurrent||geo.wantsStart)&&<button type="button" className="text-button" disabled={busy} onClick={geo.openSettings}>Открыть настройки геолокации</button>}
    {error&&<div className="availability-error" role="alert">{error}<br/><button type="button" className="text-button" disabled={busy} onClick={()=>void(retry.current===null?geo.load():geo.setOnline(retry.current))}>Повторить</button></div>}
    {settings&&<details className="courier-work-settings"><summary>Настройки работы</summary><div className="courier-work-body">
      <p>{online?`Смена до ${time}.`:'Смена действует 8 часов.'} Геопозиция обновляется, пока Qadam открыт.</p>
      {geo.saved&&<p>Позиция сохранена: {formatTime(geo.saved)}.</p>}
      <CourierGpsStatus hideContent/>
      {status?.allowsWrite?<p>Новые заказы придут в Telegram.</p>:<div className="availability-permission"><p>Получайте новые заказы в Telegram.</p>{telegram?<button type="button" className="text-button" disabled={permissions.writeBusy} onClick={async()=>{await permissions.requestWriteAccess();await geo.load();}}>{permissions.writeBusy?'Проверяем разрешение…':'Разрешить сообщения'}</button>:<p>Откройте Qadam через @qadam_delivery_bot.</p>}{permissions.notice&&<p role="status">{permissions.notice}</p>}</div>}
    </div></details>}
  </section>;
}
