'use client';

import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import type { MapPoint } from '../lib/types';
import { Button, Feedback } from './delivery-ui';

export type MapMarker = MapPoint & { kind: 'pickup' | 'destination' | 'courier'; label: string; stale?: boolean };
const almaty: [number, number] = [43.2389, 76.8897];

// The library is imported only in the browser; the provider receives tile numbers,
// never order IDs, recipient names, phone numbers or address text.
export function DeliveryMap({ markers, onPick, focusCourier = false }: { markers: MapMarker[]; onPick?: (point: MapPoint) => void; focusCourier?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const state = useRef<{ L: typeof Leaflet; map: Leaflet.Map; layer: Leaflet.LayerGroup } | null>(null);
  const latest = useRef({ markers, onPick }); latest.current = { markers, onPick };
  const courierShown = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    courierShown.current = false;
    setReady(false); setError('');
    let observer: ResizeObserver | undefined;
    void import('leaflet').then((L) => {
      if (disposed || !container.current) return;
      const map = L.map(container.current, { zoomControl: false, scrollWheelZoom: false, attributionControl: true }).setView(almaty, 13);
      const tiles = L.tileLayer(process.env.NEXT_PUBLIC_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      }).addTo(map);
      tiles.on('tileerror', () => { if (!disposed) setError('Карта не загрузилась. Проверьте интернет и повторите. Адреса и статусы доступны ниже.'); });
      const layer = L.layerGroup().addTo(map);
      state.current = { L, map, layer };
      map.on('click', (event: Leaflet.LeafletMouseEvent) => latest.current.onPick?.({ latitude: event.latlng.lat, longitude: event.latlng.lng }));
      const points = latest.current.markers.filter((point) => point.kind !== 'courier');
      const bounds = (points.length ? points : latest.current.markers).map((point): [number, number] => [point.latitude, point.longitude]);
      if (bounds.length) map.fitBounds(L.latLngBounds(bounds), { padding: [48, 48], maxZoom: 16, animate: false });
      observer = new ResizeObserver(() => map.invalidateSize()); observer.observe(container.current);
      setReady(true);
    }).catch(() => { if (!disposed) setError('Не удалось открыть карту. Проверьте интернет и повторите.'); });
    return () => { disposed = true; observer?.disconnect(); state.current?.map.remove(); state.current = null; };
  }, [attempt]);

  useEffect(() => {
    const current = state.current;
    if (!ready || !current) return;
    const { L, map, layer } = current;
    layer.clearLayers();
    for (const marker of markers) {
      const title = document.createElement('span'); title.textContent = marker.label;
      L.marker([marker.latitude, marker.longitude], {
        title: marker.label, alt: marker.label,
        icon: L.divIcon({ className: `qadam-map-marker ${marker.kind} ${marker.stale ? 'stale' : ''}`, html: marker.kind === 'pickup' ? 'А' : marker.kind === 'destination' ? 'Б' : 'К', iconSize: [44, 44], iconAnchor: [22, 22] }),
      }).bindTooltip(title).addTo(layer);
    }
    // Fit the first courier fix too, once; subsequent polling must not reset a
    // customer's chosen zoom or interrupt panning.
    if (!onPick && !courierShown.current && markers.some((point) => point.kind === 'courier')) {
      courierShown.current = true;
      map.fitBounds(L.latLngBounds(markers.map((point): [number, number] => [point.latitude, point.longitude])), { padding: [48, 48], maxZoom: 16, animate: false });
    }
    if (onPick) map.getContainer().setAttribute('aria-label', 'Выбор точки на карте. Перемещайте карту стрелками и выберите точку в центре, либо нажмите на карту.');
  }, [markers, ready, onPick]);

  const courier = markers.find((point) => point.kind === 'courier');
  return <div className="delivery-map-block">
    <div className="delivery-map-wrap">
      <div className="delivery-map" ref={container} role="region" aria-label="Карта доставки"/>
      {!ready && !error && <p className="map-loading" role="status">Загружаем карту…</p>}
      <div className="map-controls" aria-label="Управление картой">
        <button type="button" aria-label="Увеличить карту" disabled={!ready} onClick={() => state.current?.map.zoomIn()}>+</button>
        <button type="button" aria-label="Уменьшить карту" disabled={!ready} onClick={() => state.current?.map.zoomOut()}>−</button>
      </div>
      {onPick && markers.length === 0 && <span className="map-crosshair" aria-hidden="true">+</span>}
    </div>
    {onPick && <Button variant="secondary" className="wide" disabled={!ready} onClick={() => { const center = state.current?.map.getCenter(); if (center) onPick({ latitude: center.lat, longitude: center.lng }); }}>Выбрать точку в центре</Button>}
    {focusCourier && courier && <Button variant="secondary" className="wide" disabled={!ready} onClick={() => state.current?.map.setView([courier.latitude, courier.longitude], 16)}>Показать курьера</Button>}
    {error && <Feedback tone="warning" title="Карта недоступна" action={<button type="button" className="text-button" onClick={() => setAttempt((value) => value + 1)}>Повторить карту</button>}>{error}</Feedback>}
  </div>;
}

export function PointPicker({ address, kind, point, onChange }: { address: string; kind: 'pickup' | 'destination'; point: MapPoint | null; onChange: (point: MapPoint) => void }) {
  return <div className="form-fields">
    <div className="screen-heading"><h1 tabIndex={-1}>Уточните место</h1><p>Поставьте точку у входа в здание. Адрес не определяется автоматически.</p></div>
    <DeliveryMap markers={point ? [{ ...point, kind, label: address }] : []} onPick={onChange}/>
    <section className="review-section"><h2>{kind === 'pickup' ? 'Адрес отправления' : 'Адрес доставки'}</h2><p>{address || 'Вернитесь и введите улицу и дом.'}</p></section>
    <Feedback title={point ? 'Точка выбрана' : 'Выберите точку'}>{point ? `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}. Проверьте, что точка соответствует адресу.` : 'Нажмите на карту или переместите её и выберите точку в центре.'}</Feedback>
  </div>;
}
