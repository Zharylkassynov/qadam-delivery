'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/client-api';
import { CourierGpsStatus } from './courier-presence';
import type { DeliveryRoute, Order, User } from '../lib/types';
import { Button, Feedback, finished, formatTime } from './delivery-ui';
import { DeliveryMap, type MapMarker } from './delivery-map';

export function OrderTracking({ order, user, readOnly = false }: { order: Order; user: User; readOnly?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(timer); }, []);
  const location = order.courierLocation;
  const stale = !!location && now - Date.parse(location.capturedAt) > 90000;
  const markers: MapMarker[] = [];
  if (order.pickupPoint) markers.push({ ...order.pickupPoint, kind: 'pickup', label: `А · ${order.pickupAddress}` });
  if (order.destinationPoint) markers.push({ ...order.destinationPoint, kind: 'destination', label: `Б · ${order.destinationAddress}` });
  if (location) markers.push({ ...location, kind: 'courier', label: `Курьер · ${formatTime(location.capturedAt)}${stale ? ' · точка устарела' : ''}`, stale });
  const navigation = `https://www.google.com/maps/dir/?${new URLSearchParams({ api: '1', origin: order.pickupPoint ? `${order.pickupPoint.latitude},${order.pickupPoint.longitude}` : order.pickupAddress, destination: order.destinationPoint ? `${order.destinationPoint.latitude},${order.destinationPoint.longitude}` : order.destinationAddress })}`;
  return <section className="order-tracking" aria-label="Отслеживание доставки">
    <h2>Доставка на карте</h2>
    {markers.length > 0 ? <OrderRoute key={`route-${order.id}`} order={order} markers={markers}/> : <Feedback title="Точки ещё не указаны">В этом заказе сохранены только текстовые адреса. В новом заказе можно отметить отправление и доставку на карте.</Feedback>}
    <p className="map-legend">А — отправление · Б — доставка</p>
    <a href={navigation} target="_blank" rel="noopener noreferrer">Открыть навигацию</a>
    {(!order.pickupPoint || !order.destinationPoint) && markers.length > 0 && <p className="muted">{!order.pickupPoint ? 'Точка отправления не указана. ' : ''}{!order.destinationPoint ? 'Точка доставки не указана.' : ''}</p>}
    {location ? <Feedback tone={stale || finished(order) ? 'warning' : 'info'} title={finished(order) ? 'Доставка завершена · последняя точка' : stale ? 'Позиция курьера устарела' : 'Последняя позиция курьера'}>
      <p>Измерено: {formatTime(location.capturedAt)}. Получено сервером: {formatTime(location.receivedAt)}.</p>
      <p>{location.accuracy === null ? 'Точность не указана устройством.' : `Точность: около ${Math.round(location.accuracy)} м.`} {stale && !finished(order) ? 'Новых координат нет более 90 секунд. Курьер мог переместиться.' : ''}</p>
      <p>{finished(order) ? 'Новые координаты для этого заказа больше не принимаются.' : 'Новые точки поступают, пока курьер на линии, Qadam открыт и геолокация разрешена.'}</p>
    </Feedback> : order.courierId ? <Feedback title="Курьер ещё не передал позицию">Координаты появятся, когда курьер включит смену и разрешит передачу позиции.</Feedback> : null}
    {!readOnly && user.role === 'COURIER' && order.courierId === user.id && !finished(order) && <CourierGpsStatus/>}
  </section>;
}

function OrderRoute({ order, markers }: { order: Order; markers: MapMarker[] }) {
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
    {busy && <Feedback role="status" title="Строим маршрут…">Адреса и действия с заказом доступны во время расчёта.</Feedback>}
    {route && <Feedback role="status" title={`Автомаршрут · ${distance}`}>По дорогам от А к Б. Без учёта пробок.</Feedback>}
    {error && <Feedback tone="warning" role="alert" title="Не удалось построить маршрут">{error} Точки А и Б сохранены.<Button variant="secondary" className="wide" onClick={() => setAttempt(value => value + 1)}>Повторить маршрут</Button></Feedback>}
    {!hasPoints && <p className="muted">Для маршрута нужны обе точки: отправление и доставка. Можно открыть навигацию по адресам.</p>}
  </>;
}
