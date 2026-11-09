'use client';

import type {Order,User} from '../lib/types';
import {navigationLinks,navigationTarget} from '../lib/navigation-links';
import {freshLocation} from '../lib/geo-distance';
import {useCourierPresence} from './courier-presence';
import {activeTelegram} from '../lib/telegram-ui';

export function OrderNavigation({order,user}:{order:Order;user:User}) {
  const {status}=useCourierPresence();
  if(user.role!=='COURIER'||order.courierId!==user.id||!['ACCEPTED','PICKED_UP','IN_TRANSIT'].includes(order.status))return null;
  const assigned=user.role==='COURIER'&&order.courierId===user.id;
  const route=navigationTarget(order,assigned);
  const fresh=assigned&&status?.online&&status.locationSharing&&status.consentCurrent&&freshLocation(status.location)?status.location:null;
  const origin=route.origin??(fresh?{point:fresh,address:''}:null);
  const links=navigationLinks(route.target,origin,assigned&&status?.transport==='FOOT');
  return <details className="navigation-picker"><summary>Открыть навигацию</summary><div className="navigation-picker-body">
    <h3>{route.label}</h3><p>{route.target.address}</p>
    {!fresh&&<p className="field-hint">Карты определят вашу позицию.</p>}
    <div className="navigation-links">{links.map(link=><a key={link.name} href={link.href} target="_blank" rel="noopener noreferrer" onClick={event=>{const app=activeTelegram();if(app?.openLink){try{app.openLink(link.href);event.preventDefault();}catch{/* The ordinary link remains a working fallback. */}}}}><span>{link.name}</span><span aria-hidden="true">›</span></a>)}</div>
    {!links.some(link=>link.name==='2ГИС')&&<p className="field-hint">Для 2ГИС нужна точка на карте.</p>}
  </div></details>;
}
