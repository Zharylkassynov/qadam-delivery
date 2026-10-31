'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/client-api';
import { adminOrderFilters, transportLabels, type AdminOrder, type AdminOrderFilter, type AdminOrdersPage, type User } from '../lib/types';
import { serviceCity } from '../lib/service-area';
import { ApplicationScreen } from './courier-onboarding';
import { Badge, Button, EmptyState, Feedback, OrderCard, RouteCard, Skeletons, Timeline, formatTime, orderNumber } from './delivery-ui';
import { OrderTracking } from './order-tracking';
import { SavedOrderPrice } from './order-pricing';
import { PhoneLink } from './phone-link';
import { OrderRequirements } from './order-requirements';

const labels: Record<AdminOrderFilter, string> = { all: 'Все', unassigned: 'Без курьера', active: 'Активные', history: 'История' };
const message = (e: unknown) => e instanceof Error ? e.message : 'Не удалось обновить данные. Повторите.';
const denied = (e: unknown) => e instanceof ApiError && (e.status === 401 || e.status === 403);

export function AdminOrders({ user, onBack, initialOrderId }: { user: User; onBack: () => void; initialOrderId?: string }) {
  const [search, setSearch] = useState('');
  const [criteria, setCriteria] = useState({ search: '', filter: 'all' as AdminOrderFilter, take: 20 });
  const [page, setPage] = useState<AdminOrdersPage | null>(null);
  const [selected, setSelected] = useState<string | null>(initialOrderId ?? null);
  const [order, setOrder] = useState<AdminOrder | null>(null);
  const [loading, setLoading] = useState(true), [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(''), [blocked, setBlocked] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search.trim() === criteria.search) return;
      setPage(null); setCriteria(value => ({ ...value, search: search.trim(), take: 20 }));
    }, 350);
    return () => clearTimeout(timer);
  }, [search, criteria.search]);

  useEffect(() => {
    if (selected || !user.isAdmin) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    setLoading(true); setError(''); setBlocked(false);
    async function poll(first = false) {
      if (stopped) return;
      if (document.hidden && !first) { timer = setTimeout(() => void poll(), 15000); return; }
      controller = new AbortController();
      let forbidden = false;
      try {
        // Every loaded page is refreshed, including older orders after "Показать ещё".
        const chunks = Array.from({ length: Math.ceil(criteria.take / 100) }, (_, i) => {
          const query = new URLSearchParams({ search: criteria.search, filter: criteria.filter, offset: String(i * 100), limit: String(Math.min(100, criteria.take - i * 100)) });
          return api<AdminOrdersPage>(`/api/admin/orders?${query}`, undefined, controller!.signal);
        });
        const pages = await Promise.all(chunks);
        if (stopped) return;
        const orders = [...new Map(pages.flatMap(p => p.orders).map(o => [o.id, o])).values()];
        setPage({ ...pages[0], orders }); setSyncedAt(new Date().toISOString()); setError('');
      } catch (e) {
        if (stopped) return;
        forbidden = denied(e); setBlocked(forbidden); setError(message(e));
        if (forbidden) { setPage(null); setOrder(null); }
      } finally { if (!stopped) setLoading(false); }
      if (!stopped && !forbidden) timer = setTimeout(() => void poll(), 15000);
    }
    void poll(true);
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [criteria, selected, refresh, user.isAdmin]);

  useEffect(() => {
    if (!selected || !user.isAdmin) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    setDetailLoading(true); setOrder(null); setError(''); setBlocked(false);
    async function poll(first = false) {
      if (stopped) return;
      if (document.hidden && !first) { timer = setTimeout(() => void poll(), 3000); return; }
      controller = new AbortController();
      let terminal = false;
      try {
        const data = await api<{ order: AdminOrder }>(`/api/admin/orders/${selected}`, undefined, controller.signal);
        if (stopped) return;
        setOrder(data.order); setSyncedAt(new Date().toISOString()); setError('');
      } catch (e) {
        if (stopped) return;
        terminal = denied(e) || (e instanceof ApiError && e.status === 404);
        setError(message(e)); setBlocked(denied(e));
        if (terminal) setOrder(null);
        if (denied(e)) setPage(null);
      } finally { if (!stopped) setDetailLoading(false); }
      if (!stopped && !terminal) timer = setTimeout(() => void poll(), 3000);
    }
    void poll(true);
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [selected, refresh, user.isAdmin]);

  const back = () => { if (selected) { setSelected(null); setOrder(null); } else onBack(); };
  const forbidden = blocked || !user.isAdmin;
  const searching = search.trim() !== criteria.search;
  const reload = () => setRefresh(value => value + 1);
  const filter = (value: AdminOrderFilter) => { setPage(null); setCriteria(current => ({ ...current, filter: value, take: 20 })); };
  return <ApplicationScreen title={selected ? order ? `Заказ ${orderNumber(order)}` : 'Заказ' : 'Все заказы'} onBack={back} busy={false}
    wide={!selected} backLabel={selected ? 'Назад к списку заказов' : 'Назад в профиль'}
    actions={<Button variant="secondary" onClick={selected ? back : reload} disabled={!selected && (loading || searching)}>{selected ? 'К списку заказов' : loading || searching ? 'Обновляем…' : 'Обновить список'}</Button>}>
    {forbidden ? <Feedback title="Раздел недоступен" tone="error" role="alert">{error || 'Этот раздел доступен только администратору.'}</Feedback> : <>
      {error && <Feedback title="Не удалось обновить" tone="error" role="alert" action={<Button variant="ghost" onClick={reload}>Повторить</Button>}>
        {error}{syncedAt && <p>Последнее обновление: {formatTime(syncedAt)}. Статусы могут быть устаревшими.</p>}
      </Feedback>}
      {selected ? detailLoading ? <Skeletons/> : order && <AdminOrderDetail order={order} user={user}/> : <>
        <h1>Диспетчерская</h1><p className="admin-sync">{serviceCity} · список обновляется каждые 15 секунд</p>
        <div className="admin-toolbar">
          <div className="field"><label htmlFor="admin-order-search">Найти заказ</label><input id="admin-order-search" type="search" maxLength={100} value={search} onChange={e => setSearch(e.target.value)} placeholder="Номер или адрес" aria-describedby="admin-search-hint"/><small className="field-hint" id="admin-search-hint">Например, QD-0042 или Абая</small></div>
          <div className="admin-filters" role="group" aria-label="Фильтр всех заказов">{adminOrderFilters.map(value => <button type="button" className={`choice ${criteria.filter === value ? 'selected' : ''}`} aria-pressed={criteria.filter === value} key={value} onClick={() => filter(value)}>{labels[value]}{(value === 'unassigned' || value === 'active') && page ? ` · ${page.counts[value]}` : ''}</button>)}</div>
        </div>
        {searching || (loading && !page) ? <Skeletons/> : page && (page.orders.length ? <>
          <div className="order-list admin-order-list" aria-busy={loading}>{page.orders.map(o => <OrderCard key={o.id} order={o} onOpen={() => setSelected(o.id)} meta={`${o.courierName ? `Курьер: ${o.courierName}` : `Клиент: ${o.customerName}`} · ${formatTime(o.createdAt)}`}/>)}</div>
          <p className="admin-sync" role="status">Показано {page.orders.length} из {page.total} заказов</p>
          {page.orders.length < page.total && <Button variant="secondary" onClick={() => setCriteria(value => ({ ...value, take: value.take + 20 }))} disabled={loading}>{loading ? 'Загружаем…' : 'Показать ещё'}</Button>}
        </> : <EmptyState title={criteria.search || criteria.filter !== 'all' ? 'Ничего не найдено' : 'Заказов пока нет'} action={criteria.search || criteria.filter !== 'all' ? <Button variant="secondary" onClick={() => { setSearch(''); setPage(null); setCriteria({ search: '', filter: 'all', take: 20 }); }}>Сбросить фильтры</Button> : undefined}>{criteria.search || criteria.filter !== 'all' ? 'Измените запрос или сбросьте фильтры.' : 'Новые доставки появятся здесь после создания клиентом.'}</EmptyState>)}
        <p className="admin-sync">Откройте заказ, чтобы посмотреть адреса, курьера и историю статусов. Заявки курьеров доступны в профиле.</p>
      </>}
    </>}
  </ApplicationScreen>;
}

function AdminOrderDetail({ order, user }: { order: AdminOrder; user: User }) {
  const heading = { CREATED: 'Заказ создан', SEARCHING_FOR_COURIER: 'Ожидает курьера', ACCEPTED: 'Курьер забирает посылку', PICKED_UP: 'Посылка у курьера', IN_TRANSIT: 'Посылка в пути', DELIVERED: 'Доставка завершена', CANCELLED: 'Заказ отменён' }[order.status];
  const activeCourier = !!order.courierId && !['DELIVERED', 'CANCELLED'].includes(order.status);
  return <section className="admin-order-detail" aria-label="Наблюдение за заказом">
    <Badge status={order.status} label={order.status === 'ACCEPTED' ? 'Принят курьером' : undefined}/><h1>{heading}</h1>
    {!activeCourier && <p className="admin-sync">Создан {formatTime(order.createdAt)}</p>}
    {order.courierName && <div className="admin-contact"><h2>{order.courierName}</h2><p className="muted">{order.courierTransport ? transportLabels[order.courierTransport] : 'Курьер'}</p></div>}
    {activeCourier && <OrderTracking order={order} user={user} readOnly/>}
    <RouteCard pickup={order.pickupAddress} destination={order.destinationAddress}/>
    <OrderRequirements order={order}/>
      <SavedOrderPrice order={order}/>
      {(order.senderPhone||order.courierPhone)&&<section className="admin-contact"><h2>Контакты доставки</h2>{order.senderPhone&&<p>Отправитель: <PhoneLink phone={order.senderPhone}/></p>}{order.courierPhone&&<p>Курьер: <PhoneLink phone={order.courierPhone}/></p>}</section>}
    <div className="admin-contact"><small>Клиент</small><p>{order.customerName}</p><small>Получатель</small><p>{order.recipientName}{order.recipientPhone && <> · <PhoneLink phone={order.recipientPhone}/></>}</p></div>
    {order.notes && <p className="muted pre-wrap">{order.notes}</p>}
    {order.status === 'SEARCHING_FOR_COURIER' && <Feedback title="Заказ доступен курьерам">Одобренный курьер сам выбирает доставку и нажимает «Принять заказ».</Feedback>}
    <Timeline order={order} title="История заказа" acceptedLabel="Принят курьером"/>
    {!activeCourier && <OrderTracking order={order} user={user} readOnly/>}
  </section>;
}
