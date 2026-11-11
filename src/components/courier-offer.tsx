'use client';

import { useState } from 'react';
import type { Order } from '../lib/types';
import { deliveryWindow,parcelLabels,windowExpired } from '../lib/order-details';
import { distanceBetween,formatDistance,freshLocation } from '../lib/geo-distance';
import { deliveryPilot } from '../lib/delivery-pilot';
import { AddressRow,Feedback,Icon,orderNumber } from './delivery-ui';
import { formatMoney } from './order-pricing';
import { DeliveryMap,type MapMarker } from './delivery-map';
import { CourierAvailability } from './courier-availability';
import { useCourierPresence } from './courier-presence';

function OfferTags({order}:{order:Order}){
  const window=deliveryWindow(order);
  return <div className="offer-tags">{window&&<span className="important">{windowExpired(order)?'Интервал истёк · ':''}{window} · Алматы</span>}{order.parcelType&&<span>{parcelLabels[order.parcelType]}</span>}{order.fragile&&<span className="important">Хрупкое</span>}{order.surprise&&<span className="important">Сюрприз</span>}{order.urgent&&<span className="important">Без задержки</span>}</div>;
}

export function CourierOfferCard({order,onOpen,busy,pickupM,deliveryM}:{order:Order;onOpen:()=>void;busy:boolean;pickupM:number|null;deliveryM:number|null}){
  return <article className="courier-offer-card"><button type="button" className="courier-offer-open" aria-label={`Открыть заказ ${orderNumber(order)}`} disabled={busy} onClick={onOpen}>
    <div className="courier-offer-top"><strong>{order.pricing?formatMoney(order.pricing.courierPayoutKzt):'По согласованию'}</strong><small>{pickupM===null?'До забора —':`До забора ≈ ${formatDistance(pickupM)}`}</small></div>
    <div className="offer-route"><AddressRow kind="pickup" address={order.pickupAddress}/><AddressRow kind="destination" address={order.destinationAddress}/></div>
    <OfferTags order={order}/><div className="courier-offer-bottom"><span>{deliveryM===null?'Расстояние доставки неизвестно':`Доставка ≈ ${formatDistance(deliveryM)}`}</span><span>{orderNumber(order)} <Icon type="arrow"/></span></div>
  </button></article>;
}

export function CourierOfferPreview({order,telegram}:{order:Order;telegram:boolean}){
  const geo=useCourierPresence(),[mapOpen,setMapOpen]=useState(false);
  const pickupM=geo.online&&geo.status?.locationSharing&&geo.status.consentCurrent&&freshLocation(geo.status.location)?distanceBetween(geo.status.location,order.pickupPoint):null;
  const deliveryM=distanceBetween(order.pickupPoint,order.destinationPoint),expired=windowExpired(order);
  const markers:MapMarker[]=[];
  if(order.pickupPoint)markers.push({...order.pickupPoint,kind:'pickup',label:`Забрать: ${order.pickupAddress}`});
  if(order.destinationPoint)markers.push({...order.destinationPoint,kind:'destination',label:`Доставить: ${order.destinationAddress}`});
  return <section className="order-detail courier-offer-preview" aria-label="Детали заказа">
    <div className="offer-payout"><p>{order.pricing?'Вам за доставку':'Стоимость доставки'}</p><h1 tabIndex={-1}>{order.pricing?formatMoney(order.pricing.courierPayoutKzt):'По согласованию'}</h1><p>{order.payer?(order.payer==='RECIPIENT'?'Платит получатель':'Платит отправитель'):'Плательщик не указан'}{order.paymentMethod&&` · ${order.paymentMethod==='CASH'?'наличные':'перевод Kaspi'}`}</p></div>
    {expired?<Feedback title="Интервал доставки истёк" tone="warning">Выберите другой заказ.</Feedback>:!geo.canAccept&&<CourierAvailability telegram={telegram} settings={false}/>}
    <div className="offer-preview-route"><AddressRow kind="pickup" address={order.pickupAddress}/><AddressRow kind="destination" address={order.destinationAddress}/></div>
    <p className="offer-distance">{pickupM!==null&&`До забора ≈ ${formatDistance(pickupM)} · `}{deliveryM!==null?`Доставка ≈ ${formatDistance(deliveryM)} · по прямой`:'Расстояние доставки неизвестно'}</p>
    <OfferTags order={order}/>
    {order.businessName&&<p className="offer-business">{order.businessName}</p>}
    {order.pickupDetails&&<p className="focused-note">{order.pickupDetails}</p>}
    {order.notes&&<p className="focused-note">{order.notes}</p>}
    {order.surprise&&<p className="offer-important">Перед звонком получателю свяжитесь с отправителем.</p>}
    <details className="order-disclosure offer-map" onToggle={event=>setMapOpen(event.currentTarget.open)}><summary>Посмотреть на карте</summary><div className="order-disclosure-body">{mapOpen&&(markers.length?<DeliveryMap markers={markers}/>:<p className="muted">Точки пока не указаны. Ориентируйтесь по адресам.</p>)}</div></details>
    <details className="order-disclosure"><summary>Условия доставки</summary><div className="order-disclosure-body">
      <p>{order.pricing?`Цена зафиксирована. Комиссия Qadam — ${formatMoney(order.pricing.platformFeeKzt)}.`:'Согласуйте сумму до передачи посылки.'} Оплата напрямую курьеру.</p>
      {order.pricing?.breakdown.pilotTermsVersion===deliveryPilot.termsVersion&&<p>До двери · до 5 кг · каждая сторона до 40 см. По 5 минут на забор и вручение. Автоматических доплат нет.</p>}
      {order.fragile&&<p>Хрупкое — бережно, не переворачивать.</p>}
      {['FLOWERS','CAKE'].includes(order.parcelType??'')&&<p>Уточните транспорт и упаковку. Наличие термобокса не подразумевается.</p>}
      {order.urgent&&<p>Без задержки. Автоматической доплаты нет.</p>}
      <p>Расстояния по прямой. Путь по дорогам может быть длиннее.</p>
      {order.handoffRequired&&<p>Забор и вручение подтверждаются разными кодами.</p>}
      {order.photoRequired&&<p>При вручении нужно фото упаковки.</p>}
      {!order.handoffRequired&&order.codeRequired&&<p>Получатель подтвердит вручение кодом.</p>}
    </div></details>
    <p className="offer-contact-lock">Контакты откроются после принятия.</p>
  </section>;
}
