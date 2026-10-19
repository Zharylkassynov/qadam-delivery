import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { statusLabels, type Order, type Status } from '../lib/types';
import { serviceTimezone } from '../lib/service-area';

type IconName = 'box' | 'clock' | 'person' | 'locate' | 'phone' | 'check' | 'pin' | 'back' | 'arrow' | 'logout' | 'refresh';
const assetSizes = { box: [19.8, 20.8], clock: [19.8, 19.8], person: [17.8, 18.8], locate: [18.1667, 18.1667], phone: [19.8, 19.8], check: [18.4, 14.4] } as const;

export function Icon({ type }: { type: IconName }) {
  if (type in assetSizes) {
    const [width, height] = assetSizes[type as keyof typeof assetSizes];
    return <span className="icon" aria-hidden="true"><img src={`/icons/${type}.svg`} width={width} height={height} alt=""/></span>;
  }
  const paths: Partial<Record<IconName, ReactNode>> = {
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2"/></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
    back: <path d="M20 12H4m6-6-6 6 6 6"/>,
    logout: <path d="M9 4H4v16h5m6-12 4 4-4 4m-7-4h11"/>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.6-2L20 8M4 16l2.3 3A7 7 0 0 0 17.9 17"/></>,
  };
  return <svg className="icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[type]}</svg>;
}

export function Brand() {
  return <div className="brand"><span className="brand-mark"><Icon type="box"/></span><span>Qadam<span className="brand-subtitle">Delivery</span></span></div>;
}

export function Button({ children, variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return <button type="button" className={`button ${variant} ${className}`} {...props}>{children}</button>;
}

export function Feedback({ title, children, tone = 'info', role, action }: { title: string; children?: ReactNode; tone?: 'info' | 'warning' | 'error' | 'success'; role?: 'alert' | 'status'; action?: ReactNode }) {
  return <div className={`feedback feedback-${tone}`} role={role}><div><p className="feedback-title">{title}</p>{children && <div className="feedback-description">{children}</div>}</div>{action}</div>;
}

export function Badge({ status }: { status: Status }) {
  return <span className={`status-badge status-${status.toLowerCase()}`}>{statusLabels[status]}</span>;
}

export function AddressRow({ kind, address }: { kind: 'pickup' | 'destination'; address: string }) {
  return <div className="address-row"><span className={`address-marker ${kind}`} aria-hidden="true">{kind === 'pickup' ? 'А' : 'Б'}</span><div><small>{kind === 'pickup' ? 'Забрать' : 'Доставить'}</small><p>{address}</p></div></div>;
}

export function RouteCard({ pickup, destination }: { pickup: string; destination: string }) {
  return <div className="route-card"><AddressRow kind="pickup" address={pickup}/><div className="divider"/><AddressRow kind="destination" address={destination}/></div>;
}

export const orderNumber = (order: Order) => `QD-${order.number.padStart(4, '0')}`;
export const finished = (order: Order) => order.status === 'DELIVERED' || order.status === 'CANCELLED';
export const formatTime = (at: string) => new Intl.DateTimeFormat('ru-KZ', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: serviceTimezone }).format(new Date(at));
export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();

export function OrderCard({ order, onOpen, onAccept, busy }: { order: Order; onOpen: () => void; onAccept?: () => void; busy?: boolean }) {
  return <article className={`order-card ${onAccept ? 'available-card' : ''}`}>
    <button type="button" className="order-card-open" aria-label={`Открыть заказ ${orderNumber(order)}`} onClick={onOpen} disabled={busy}>
      <div className="order-card-heading"><strong>{orderNumber(order)}</strong><Badge status={order.status}/></div>
      <AddressRow kind="pickup" address={order.pickupAddress}/><AddressRow kind="destination" address={order.destinationAddress}/>
      <p className="card-meta">{formatTime(order.createdAt)}{order.courierName && ` · ${order.courierName}`}</p>
    </button>
    {onAccept && <div className="available-card-action"><Feedback title="Оплата по согласованию">Условия доставки уточняются до начала заказа.</Feedback><Button onClick={onAccept} disabled={busy} className="wide">{busy ? 'Принимаем…' : 'Принять заказ'}</Button></div>}
  </article>;
}

export function Skeletons() {
  return <div className="skeleton-list" role="status" aria-label="Загружаем заказы"><span className="sr-only">Загружаем заказы…</span>{[0, 1, 2].map((i) => <div className="skeleton-card" aria-hidden="true" key={i}><div className="skeleton-line short"/><div className="skeleton-line"/><div className="skeleton-line"/><div className="skeleton-line short"/></div>)}</div>;
}

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-symbol"><Icon type="box"/></div><h2>{title}</h2><p className="muted">{children}</p>{action}</div>;
}

export function PriceNote() {
  return <div className="price-row"><span>Стоимость доставки</span><strong>По согласованию</strong></div>;
}

export function Timeline({ order }: { order: Order }) {
  return <section className="timeline-section" aria-label="История статусов"><h2>Путь заказа</h2><ol className="timeline">{order.events.map((event) => <li key={event.id}><span className="timeline-mark" aria-hidden="true">✓</span><div><strong>{statusLabels[event.status]}</strong><small>{formatTime(event.at)} · {event.actor}</small></div></li>)}</ol></section>;
}

export function MapUnavailable({ order }: { order: Order }) {
  const href = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(order.pickupAddress)}&destination=${encodeURIComponent(order.destinationAddress)}`;
  return <section className="map-section" aria-label="Маршрут доставки"><div className="map-unavailable"><span className="map-symbol"><Icon type="pin"/></span><h2>Маршрут по адресам</h2><p>Точки ещё не отмечены на карте.</p><a className="button secondary" href={href} target="_blank" rel="noopener noreferrer">Открыть навигацию<Icon type="arrow"/></a></div><Feedback tone="warning" title="Координаты пока недоступны">Геолокация ещё не подключена. Статус доставки сохраняется и обновляется отдельно.</Feedback></section>;
}
