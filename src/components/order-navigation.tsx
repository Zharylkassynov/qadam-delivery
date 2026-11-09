'use client';

import type {Order,User} from '../lib/types';
import {navigationLinks,navigationTarget} from '../lib/navigation-links';
import {freshLocation} from '../lib/geo-distance';
import {useCourierPresence} from './courier-presence';
import {activeTelegram} from '../lib/telegram-ui';

export function OrderNavigation({order,user}:{order:Order;user:User}) {
  const {status}=useCourierPresence();
  const assigned=user.role==='COURIER'&&order.courierId===user.id;
  const route=navigationTarget(order,assigned);
  const fresh=assigned&&status?.online&&status.locationSharing&&status.consentCurrent&&freshLocation(status.location)?status.location:null;
  const origin=route.origin??(fresh?{point:fresh,address:''}:null);
  const links=navigationLinks(route.target,origin,assigned&&status?.transport==='FOOT');
  return <details className="navigation-picker"><summary>Открыть навигацию</summary><div className="navigation-picker-body">
    <h3>Открыть маршрут</h3><p className="muted">{route.label}</p><p>{route.target.address}</p>
    {assigned&&!route.origin&&<p className="field-hint">{fresh?'Начальная точка — свежая позиция курьера.':'Карты определят местоположение сами. В Qadam нет свежей позиции для начала маршрута.'}</p>}
    <div className="navigation-links">{links.map(link=><a key={link.name} href={link.href} target="_blank" rel="noopener noreferrer" onClick={event=>{const app=activeTelegram();if(app?.openLink){try{app.openLink(link.href);event.preventDefault();}catch{/* The ordinary link remains a working fallback. */}}}}><span>{link.name}</span><span aria-hidden="true">›</span></a>)}</div>
    {!links.some(link=>link.name==='2ГИС')&&<p className="field-hint">Для 2ГИС нужна точка на карте. Адрес можно открыть в Яндекс Картах или Google Maps.</p>}
  </div></details>;
}
