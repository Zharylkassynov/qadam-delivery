'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/client-api';
import { CourierGpsStatus } from './courier-presence';
import type { DeliveryRoute, Order, User } from '../lib/types';
import { Button, Feedback, finished, formatTime } from './delivery-ui';
import { DeliveryMap, type MapMarker } from './delivery-map';
import {OrderNavigation} from './order-navigation';

export function OrderTracking({ order, user, readOnly = false,focused=false }: { order: Order; user: User; readOnly?: boolean;focused?:boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(timer); }, []);
  const location = order.courierLocation;
  const stopped=location?.sharingStopped===true;
  const stale = !!location && (stopped||now - Date.parse(location.capturedAt) > 90000);
  const telegramSource=location?.source==='TELEGRAM_LIVE';
  const courierControls=!readOnly&&user.role==='COURIER'&&order.courierId===user.id&&!finished(order);
  const routeControls=!readOnly&&!focused&&user.role==='COURIER'&&!finished(order);
  const markers: MapMarker[] = [];
  if (order.pickupPoint) markers.push({ ...order.pickupPoint, kind: 'pickup', label: `А · ${order.pickupAddress}` });
  if (order.destinationPoint) markers.push({ ...order.destinationPoint, kind: 'destination', label: `Б · ${order.destinationAddress}` });
  if (location) markers.push({ ...location, kind: 'courier', label: `Курьер · ${formatTime(location.capturedAt)}${stale ? ' · точка устарела' : ''}`, stale });
  return <section className="order-tracking" aria-label="Отслеживание доставки">
    <h2>{focused?'На карте':'Доставка на карте'}</h2>
    {markers.length > 0 ? <OrderRoute key={`route-${order.id}`} order={order} markers={markers} controls={routeControls}/> : <p className="muted">Точки ещё не указаны</p>}
    {!focused&&<p className="map-legend">А — отправление · Б — доставка</p>}
    {courierControls&&!focused&&<OrderNavigation order={order} user={user}/>}
    {(!order.pickupPoint || !order.destinationPoint) && markers.length > 0 && <p className="muted">{!order.pickupPoint ? 'Точка отправления не указана. ' : ''}{!order.destinationPoint ? 'Точка доставки не указана.' : ''}</p>}
    {focused?<p className={`focused-location ${stale?'stale':''}`} role="status">{location?stopped?'Геопозиция отключена':stale?'Позиция устарела · показана последняя точка':`Позиция обновлена в ${new Intl.DateTimeFormat('ru-KZ',{hour:'2-digit',minute:'2-digit'}).format(new Date(location.capturedAt))}`:'Ждём позицию курьера'}</p>:location ? <Feedback tone={stale || finished(order) ? 'warning' : 'info'} title={finished(order) ? 'Доставка завершена · последняя точка' : stopped?'Передача геопозиции остановлена':stale ? 'Позиция курьера устарела' : 'Последняя позиция курьера'}>
      <p>{telegramSource?'Telegram':'Обновлено'}: {formatTime(location.capturedAt)}. {location.accuracy === null ? '' : `Точность: около ${Math.round(location.accuracy)} м.`}</p>
      {(stopped||stale)&&<p>Показана последняя известная точка.</p>}
    </Feedback> : order.courierId ? <p className="muted">Ждём позицию курьера</p> : null}
    {courierControls&&!focused&&<CourierGpsStatus/>}
  </section>;
}

function OrderRoute({ order, markers,controls }: { order: Order; markers: MapMarker[];controls:boolean }) {
  const [route, setRoute] = useState<DeliveryRoute | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const hasPoints = !!order.pickupPoint && !!order.destinationPoint;
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setRoute(null); setError(''); setBusy(hasPoints);
    const timer = setTimeout(() => { if (hasPoints) void api<{ route: DeliveryRoute | null }>(`/api/orders/${order.id}/route`, undefined, controller.signal)
      .then((data) => { if (active) { setRoute(data.route); if (!data.route) setError('В заказе не хватает координат. Откройте навигацию по адресам.'); } })
      .catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : 'Не удалось построить маршрут.'); })
      .finally(() => { if (active) setBusy(false); }); }, 0);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
    // Order polling changes its object and GPS, but never needs a new A-to-B route.
  }, [order.id, order.pickupPoint?.latitude, order.pickupPoint?.longitude, order.destinationPoint?.latitude, order.destinationPoint?.longitude, hasPoints, attempt]);
  const distance = route && (route.distanceMeters < 1000 ? `${Math.round(route.distanceMeters)} м` : `${new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 1 }).format(route.distanceMeters / 1000)} км`);
  return <>
    <DeliveryMap markers={markers} route={route} focusCourier/>
    {busy&&controls&&<p role="status" className="muted">Строим маршрут…</p>}
    {route&&<p role="status" className="muted">Автомаршрут · {distance}</p>}
    {error&&controls&&<Feedback tone="warning" role="alert" title="Не удалось построить маршрут"><Button variant="secondary" className="wide" onClick={() => setAttempt(value => value + 1)}>Повторить маршрут</Button></Feedback>}
  </>;
}
