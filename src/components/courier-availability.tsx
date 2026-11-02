'use client';

import { useRef } from 'react';
import { serviceTimezone } from '../lib/service-area';
import { useTelegramProfile } from './telegram-permissions';
import { CourierGpsStatus,useCourierPresence } from './courier-presence';

export function CourierAvailability({telegram}:{telegram:boolean}) {
  const geo=useCourierPresence(),permissions=useTelegramProfile(telegram,15000),retry=useRef<boolean|null>(null);
  const {status,online,busy,error}=geo;
  const accepting=online&&!!status?.acceptingOrders;
  const time=status?.expiresAt?new Intl.DateTimeFormat('ru-KZ',{hour:'2-digit',minute:'2-digit',timeZone:serviceTimezone}).format(new Date(status.expiresAt)):'';
  async function save(value:boolean){retry.current=value;await geo.setOnline(value);}
  return <section className={`courier-shift ${online?'is-online':''}`} aria-label="Готовность к заказам" aria-busy={busy}>
    <div className="availability-row"><strong><span className="availability-dot"/>{busy?'Сохраняем…':!status?'Проверяем статус…':status.endingAfterDelivery?'Смена закончится после доставки':geo.canAccept?'Можно принимать заказы':online?'Нужна свежая геопозиция':'Не на линии'}</strong>
      <button type="button" className="availability-switch" role="switch" aria-label="Я на линии" aria-checked={accepting} disabled={!status||busy} onClick={()=>void save(!accepting)}><span/></button></div>
    <p className="availability-hint">{status?.endingAfterDelivery?'Приём новых выключен. Позиция используется для текущих доставок до их завершения, отзыва согласия или окончания срока смены.':online?`На линии до ${time}. Новые заказы можно принять после получения свежей позиции сервером.`:status?.expired?'Смена завершилась через 8 часов. Включите режим, если готовы продолжить.':'Включите, когда готовы принимать заказы. Режим действует 8 часов.'}</p>
    <CourierGpsStatus/>
    {accepting&&status?.allowsWrite&&<p className="availability-hint">Новые заказы придут в Telegram.</p>}
    {online&&<p className="availability-hint">Позиция обновляется, пока Qadam открыт. После возвращения передача продолжится автоматически.</p>}
    {online&&!status?.allowsWrite&&<div className="availability-permission"><p>Чтобы получать заказы в Telegram, разрешите боту отправлять сообщения.</p>{telegram?<button type="button" className="text-button" disabled={permissions.writeBusy} onClick={async()=>{await permissions.requestWriteAccess();await geo.load();}}>{permissions.writeBusy?'Проверяем разрешение…':'Разрешить сообщения'}</button>:<p>Откройте Qadam через @qadam_delivery_bot.</p>}{permissions.notice&&<p role="status">{permissions.notice}</p>}</div>}
    {error&&<div className="availability-error" role="alert">{error}<br/><button type="button" className="text-button" disabled={busy} onClick={()=>void(retry.current===null?geo.load():geo.setOnline(retry.current))}>Повторить</button></div>}
  </section>;
}
