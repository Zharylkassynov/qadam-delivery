'use client';

import type { Order } from '../lib/types';
import { serviceCity } from '../lib/service-area';
import { AddressRow, Badge, Button, Icon, orderNumber } from './delivery-ui';
import { DeliveryMap } from './delivery-map';
import { ParcelChoice, type OrderDraft } from './order-form';
import './customer-home.css';

type Props = {
  draft: OrderDraft;
  activeOrders: Order[];
  creatingNew: boolean;
  loading: boolean;
  busy: boolean;
  onAddress: (kind: 'pickup' | 'destination') => void;
  onParcel: (value: OrderDraft['parcelType']) => void;
  onContinue: () => void;
  onNew: () => void;
  onOpen: (order: Order) => void;
  onOrders: () => void;
};

export function CustomerHome({ draft, activeOrders, creatingNew, loading, busy, onAddress, onParcel, onContinue, onNew, onOpen, onOrders }: Props) {
  const active = creatingNew ? undefined : activeOrders[0];
  const route = active ?? draft;
  const addressesReady = draft.pickupAddress.trim().length >= 5 && draft.destinationAddress.trim().length >= 5;
  return <div className={`customer-home ${active ? 'customer-home-active' : ''}`}>
    <section className="customer-home-map" aria-label="Адреса на карте">
      <DeliveryMap key={active?.id ?? 'draft'} markers={[
        ...(route.pickupPoint ? [{ ...route.pickupPoint, kind: 'pickup' as const, label: `А · ${route.pickupAddress}` }] : []),
        ...(route.destinationPoint ? [{ ...route.destinationPoint, kind: 'destination' as const, label: `Б · ${route.destinationAddress}` }] : []),
      ]}/>
      <div className="customer-home-city"><Icon type="pin"/>{serviceCity}</div>
    </section>
    <section className="customer-home-panel" aria-label={active ? 'Текущая доставка' : 'Новая доставка'}>
      <h1 tabIndex={-1}>{active ? 'Текущая доставка' : 'Куда доставить?'}</h1>
      {active && <div className="customer-home-order-meta"><Badge status={active.status}/><span>{orderNumber(active)}</span></div>}
      <div className="customer-home-addresses">
        {(['pickup', 'destination'] as const).map((kind, index) => <div key={kind}>
          {index > 0 && <div className="divider"/>}
          {active ? <AddressRow kind={kind} address={route[`${kind}Address`]}/> : <button type="button" className="address-edit" onClick={() => onAddress(kind)} disabled={busy} aria-label={kind === 'pickup' ? 'Изменить адрес отправления' : 'Изменить адрес доставки'}><AddressRow kind={kind} address={draft[`${kind}Address`] || (kind === 'pickup' ? 'Откуда забрать?' : 'Куда доставить?')}/></button>}
        </div>)}
      </div>
      {active ? <>
        <Button className="wide" onClick={() => onOpen(active)} disabled={busy}>Открыть доставку</Button>
        <Button variant="secondary" className="wide" onClick={onNew} disabled={busy}>Новая доставка</Button>
        {activeOrders.length > 1 && <button type="button" className="text-button" onClick={onOrders} disabled={busy}>Все активные доставки · {activeOrders.length}</button>}
      </> : <>
        <ParcelChoice value={draft.parcelType} onChange={onParcel} disabled={busy}/>
        <Button className="wide" onClick={onContinue} disabled={busy}>{addressesReady ? 'Далее — получатель' : 'Указать адреса'}</Button>
        <p className="customer-home-note" role={loading ? 'status' : undefined}>{loading ? 'Загружаем доставки…' : activeOrders.length ? 'Черновик новой доставки' : 'Пока нет доставок'}</p>
      </>}
    </section>
  </div>;
}
