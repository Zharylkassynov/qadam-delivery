'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/client-api';
import { currentLocation } from '../lib/device-location';
import type { CourierLocation, Order, User } from '../lib/types';
import { Button, Feedback, finished, formatTime } from './delivery-ui';
import { DeliveryMap, type MapMarker } from './delivery-map';

export function OrderTracking({ order, user }: { order: Order; user: User }) {
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
    {markers.length > 0 ? <DeliveryMap markers={markers} focusCourier/> : <Feedback title="Точки ещё не указаны">В этом заказе сохранены только текстовые адреса. В новом заказе можно отметить отправление и доставку на карте.</Feedback>}
    <p className="map-legend">А — отправление · Б — доставка · К — курьер</p>
    <a href={navigation} target="_blank" rel="noopener noreferrer">Открыть навигацию</a>
    {(!order.pickupPoint || !order.destinationPoint) && markers.length > 0 && <p className="muted">{!order.pickupPoint ? 'Точка отправления не указана. ' : ''}{!order.destinationPoint ? 'Точка доставки не указана.' : ''}</p>}
    {location ? <Feedback tone={stale || finished(order) ? 'warning' : 'info'} title={finished(order) ? 'Доставка завершена · последняя точка' : stale ? 'Позиция курьера устарела' : 'Последняя позиция курьера'}>
      <p>Измерено: {formatTime(location.capturedAt)}. Получено сервером: {formatTime(location.receivedAt)}.</p>
      <p>{location.accuracy === null ? 'Точность не указана устройством.' : `Точность: около ${Math.round(location.accuracy)} м.`} {stale && !finished(order) ? 'Новых координат нет более 90 секунд. Курьер мог переместиться.' : ''}</p>
      <p>{finished(order) ? 'Новые координаты для этого заказа больше не принимаются.' : 'Новые точки поступают, пока у курьера открыт заказ и включена геолокация.'}</p>
    </Feedback> : order.courierId ? <Feedback title="Курьер ещё не передал позицию">Координаты появятся, когда курьер разрешит геолокацию и включит её в заказе.</Feedback> : null}
    {user.role === 'COURIER' && order.courierId === user.id && <CourierSharing key={order.id} orderId={order.id} active={!finished(order)}/>}
  </section>;
}

function CourierSharing({ orderId, active }: { orderId: string; active: boolean }) {
  const [sharing, setSharing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const run = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const request = useRef<AbortController | null>(null);
  const stop = useCallback(() => {
    run.current++; clearTimeout(timer.current); request.current?.abort();
    setSharing(false); setPending(false);
  }, []);
  useEffect(() => {
    const app = window.Telegram?.WebApp;
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', stop);
    app?.onEvent?.('deactivated', stop);
    if (!active) stop();
    return () => { run.current++; clearTimeout(timer.current); request.current?.abort(); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', stop); app?.offEvent?.('deactivated', stop); };
  }, [active, stop]);
  async function start() {
    if (!active || document.hidden || window.Telegram?.WebApp?.isActive === false) return;
    const generation = ++run.current;
    setError(''); setSharing(true);
    async function send() {
      if (generation !== run.current || document.hidden) return;
      setPending(true);
      try {
        const fix = await currentLocation();
        if (generation !== run.current || document.hidden || window.Telegram?.WebApp?.isActive === false) return;
        const controller = new AbortController(); request.current = controller;
        const data = await api<{ location: CourierLocation }>(`/api/orders/${orderId}/location`, fix, controller.signal);
        if (generation !== run.current) return;
        setSaved(data.location.receivedAt); setError('');
      } catch (failure) {
        if (generation !== run.current) return;
        const retryable = failure instanceof ApiError && (failure.status === 429 || failure.status === 503);
        setError(failure instanceof Error ? failure.message : 'Не удалось отправить позицию.');
        if (!retryable) { setSharing(false); setPending(false); run.current++; return; }
      } finally { if (generation === run.current) setPending(false); }
      if (generation === run.current) timer.current = setTimeout(() => void send(), 15000);
    }
    await send();
  }
  if (!active) return null;
  const manager = window.Telegram?.WebApp?.LocationManager;
  return <div className="courier-sharing">
    <h3>Ваша геолокация</h3>
    <p className="muted">Клиент увидит последнюю переданную точку. Оставьте этот заказ открытым. При сворачивании приложения передача остановится; включите её снова после возвращения.</p>
    {saved && <p role="status">Позиция сохранена: {formatTime(saved)}</p>}
    {error && <Feedback tone="warning" title="Позиция не отправлена" role="alert">{error} Доставку можно продолжить без геолокации.</Feedback>}
    {manager?.isAccessRequested && !manager.isAccessGranted && <Button variant="secondary" onClick={() => manager.openSettings()}>Настройки геолокации Telegram</Button>}
    <Button variant="secondary" className="wide" onClick={() => sharing ? stop() : void start()}>{sharing ? pending ? 'Остановить · получаем позицию…' : 'Остановить передачу позиции' : 'Передавать геопозицию'}</Button>
  </div>;
}
