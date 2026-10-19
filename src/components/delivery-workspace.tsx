'use client';

import { useEffect, useRef, useState } from 'react';
import { actionLabels, nextStatus, type MapPoint, type Order, type User } from '../lib/types';
import { AddressRow, Badge, Brand, Button, EmptyState, Feedback, Icon, OrderCard, PriceNote, RouteCard, Skeletons, Timeline, finished, formatTime, initials, orderNumber } from './delivery-ui';
import { emptyDraft, OrderForm, OrderReview, ParcelChoice, orderPayload, type OrderDraft } from './order-form';
import { serviceCity, serviceTimezone } from '../lib/service-area';
import { CourierOnboarding, CourierApplicationAdmin } from './courier-onboarding';
import { PointPicker } from './delivery-map';
import { OrderTracking } from './order-tracking';

type View = 'home' | 'orders' | 'profile' | 'create' | 'review' | 'detail' | 'point' | 'courierApplication' | 'adminApplications';
type Filter = 'all' | 'active' | 'history';
type Props = {
  user: User; orders: Order[]; loading: boolean; busy: boolean; error: string; notice: string;
  syncError: string; syncedAt: string | null; selected: string | null;
  onSelect: (id: string) => void; onSignOut: () => Promise<void>; onRefresh: () => void; onClearMessages: () => void;
  onMutate: (path: string, body: unknown, success: string) => Promise<boolean>;
  onCreate: (input: ReturnType<typeof orderPayload>) => Promise<boolean>;
};

export function DeliveryWorkspace(props: Props) {
  const { user, orders, loading, busy, error, notice, syncError, syncedAt, selected } = props;
  const [view, setView] = useState<View>('home');
  const [filter, setFilter] = useState<Filter>(user.role === 'CUSTOMER' ? 'all' : 'active');
  const [draft, setDraft] = useState<OrderDraft>({ ...emptyDraft });
  const [pointKind, setPointKind] = useState<'pickup' | 'destination'>('pickup');
  const [point, setPoint] = useState<MapPoint | null>(null);
  const bodyRef = useRef<HTMLElement>(null);
  const customer = user.role === 'CUSTOMER';
  const ownOrders = customer ? orders : orders.filter((order) => order.courierId === user.id);
  const activeOrders = ownOrders.filter((order) => !finished(order));
  const completed = ownOrders.filter((order) => order.status === 'DELIVERED');
  const available = orders.filter((order) => order.status === 'SEARCHING_FOR_COURIER' && !order.courierId);
  const visible = ownOrders.filter((order) => filter === 'all' || (filter === 'history' ? finished(order) : !finished(order)));
  const detail = orders.find((order) => order.id === selected);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
    bodyRef.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }, [view, selected]);

  useEffect(() => {
    setFilter(user.role === 'COURIER' ? 'active' : 'all');
    setView((current) => current === 'courierApplication' || current === 'adminApplications' ? current : 'home');
  }, [user.role]);

  function navigate(target: View) {
    if (busy) return;
    props.onClearMessages();
    setView(target);
  }
  function open(order: Order) { props.onSelect(order.id); navigate('detail'); }
  function history() { setFilter('history'); navigate('orders'); }
  async function accept(order: Order) {
    if (await props.onMutate(`/api/orders/${order.id}/accept`, {}, 'Заказ принят. Заберите посылку у отправителя.')) setView('detail');
  }
  async function advance(order: Order) {
    const target = nextStatus[order.status];
    if (target) await props.onMutate(`/api/orders/${order.id}/status`, { status: target }, target === 'DELIVERED' ? 'Доставка завершена. Заказ сохранён в истории.' : 'Статус обновлён. Клиент увидит изменение автоматически.');
  }
  async function confirmOrder() {
    if (await props.onCreate(orderPayload(draft))) { setDraft({ ...emptyDraft }); setView('detail'); }
  }
  const actionable = view === 'detail' && detail && !customer && (detail.status === 'SEARCHING_FOR_COURIER' || (detail.courierId === user.id && nextStatus[detail.status]));
  const completedDetail = view === 'detail' && detail && finished(detail);
  const hasFooter = view === 'create' || view === 'review' || view === 'point' || !!actionable || !!completedDetail;
  const showNav = view === 'home' || view === 'orders' || view === 'profile';
  const title = view === 'point' ? 'Точка на карте' : view === 'home' ? customer ? serviceCity : 'Заказы рядом' : view === 'orders' ? 'Мои заказы' : view === 'profile' ? 'Профиль' : view === 'create' ? 'Новая доставка' : view === 'review' ? 'Проверка заказа' : detail ? `Заказ ${orderNumber(detail)}` : 'Заказ недоступен';
  const navItems: { view: View; label: string; icon: 'box' | 'clock' | 'person' }[] = [
    { view: 'home', label: customer ? 'Доставка' : 'Доступные', icon: 'box' },
    { view: 'orders', label: customer ? 'Заказы' : 'Мои заказы', icon: 'clock' },
    { view: 'profile', label: 'Профиль', icon: 'person' },
  ];
  const card = (order: Order) => <OrderCard key={order.id} order={order} busy={busy} onOpen={() => open(order)}/>;
  const refresh = <Button variant="secondary" onClick={props.onRefresh} disabled={busy}>Обновить список</Button>;

  if (view === 'courierApplication') return <CourierOnboarding user={user} onBack={() => navigate('profile')} onOrders={() => { props.onRefresh(); navigate('home'); }}/>;
  if (view === 'adminApplications') return <CourierApplicationAdmin user={user} onBack={() => navigate('profile')}/>;

  return <div className="app-shell">
    <aside className="sidebar"><Brand/><div className="sidebar-role">{customer ? 'Клиент' : 'Курьер'} · {serviceCity}</div>
      <nav aria-label="Разделы">{navItems.map((item) => <button type="button" key={item.view} aria-label={item.view === 'orders' ? 'Мои заказы' : item.label} className={`sidebar-link ${view === item.view ? 'current' : ''}`} aria-current={view === item.view ? 'page' : undefined} onClick={() => navigate(item.view)} disabled={busy}><Icon type={item.icon}/>{item.view === 'orders' ? 'Мои заказы' : item.label}{item.view === 'orders' && activeOrders.length > 0 && <span className="nav-count" aria-hidden="true">{activeOrders.length}</span>}</button>)}</nav>
      <div className="sidebar-account"><span className="avatar">{initials(user.name)}</span><div><strong>{user.name}</strong><small>Демонстрационный аккаунт</small></div></div>
      <p className="sidebar-caption">Учебный MVP · 2026<br/>Заказы сохраняются в базе</p>
    </aside>
    <div className={`workspace ${hasFooter ? 'with-action' : ''} ${showNav ? 'with-nav' : ''}`}>
      <header className="product-header"><span className="product-header-mark"><Icon type="box"/></span><span>Qadam Delivery</span><button type="button" className="icon-button" aria-label="Выйти" title="Выйти" onClick={() => void props.onSignOut()} disabled={busy}><Icon type="logout"/></button></header>
      <div className="app-bar">{view === 'home' ? <span className="app-bar-city"><Icon type="pin"/></span> : <button type="button" className="icon-button" aria-label="Назад" disabled={busy} onClick={() => navigate(view === 'review' || view === 'point' ? 'create' : 'home')}><Icon type="back"/></button>}<p>{title}</p><span className="app-bar-balance"/></div>
      <main className={`screen-body screen-${view}`} ref={bodyRef} id="main-content">
        <div className="screen-content">
          {error && <Feedback tone="error" title={error} role="alert" action={<button type="button" className="feedback-dismiss" aria-label="Закрыть сообщение" onClick={props.onClearMessages}>×</button>}/>}
          {notice && <Feedback tone="success" title={notice} role="status"/>}
          {syncError && <Feedback tone="error" title="Данные не обновлены" role="alert" action={<button type="button" className="text-button" onClick={props.onRefresh}>Повторить</button>}>{syncError}{syncedAt && <p>Последнее обновление: {formatTime(syncedAt)}. Статусы могут быть устаревшими.</p>}</Feedback>}

          {view === 'home' && customer && <div className="home-layout"><section className="home-create"><div className="screen-heading"><h1 tabIndex={-1}>Доставка<br/>по {serviceCity}</h1><p>Для посылок, документов<br/>и заказов из магазина</p></div>
            <div className="route-card home-route"><button type="button" onClick={() => navigate('create')} disabled={busy}><AddressRow kind="pickup" address={draft.pickupAddress || 'Откуда забрать?'}/></button><div className="divider"/><button type="button" onClick={() => navigate('create')} disabled={busy}><AddressRow kind="destination" address={draft.destinationAddress || 'Куда доставить?'}/></button></div>
            <ParcelChoice compact value={draft.parcelType} onChange={(type) => setDraft((value) => ({ ...value, parcelType: type }))} disabled={busy}/>
            <Button className="wide" onClick={() => navigate('create')} disabled={busy}>Заказать доставку</Button>
          </section><section className="home-orders" aria-label="Ваши доставки"><h2>Активные доставки</h2>{loading ? <Skeletons/> : activeOrders.length ? <div className="order-list">{activeOrders.slice(0, 3).map(card)}</div> : <EmptyState title="Пока нет доставок">Создайте заказ — он появится здесь, и курьер сможет его принять.</EmptyState>}
            <h2>Последние заказы</h2>{!loading && completed.length > 0 && card(completed[0])}<Button variant="ghost" className="wide" onClick={history} disabled={busy}>Открыть историю</Button></section></div>}

          {view === 'home' && !customer && <><div className="screen-heading"><h1 tabIndex={-1}>Можно принять</h1><p>Доступные заказы. Условия доставки уточняются до начала заказа.</p></div><p className="city-label"><Icon type="locate"/>{serviceCity} · город демонстрации</p>
            {activeOrders.length > 0 && <Button variant="secondary" onClick={() => { setFilter('active'); navigate('orders'); }} disabled={busy}>Мои активные доставки · {activeOrders.length}</Button>}
            {loading ? <Skeletons/> : available.length ? <div className="order-list courier-list">{available.map((order) => <OrderCard key={order.id} order={order} onOpen={() => open(order)} onAccept={() => void accept(order)} busy={busy}/>)}</div> : <EmptyState title="Пока нет заказов" action={refresh}>Новые доставки появятся в этом списке. Можно обновить его вручную.</EmptyState>}
            <SyncTime value={syncedAt} offline={!!syncError}/></>}

          {view === 'orders' && <><h1 className="sr-only" tabIndex={-1}>Мои заказы</h1>{!customer && <h2 className="list-title">Ваши доставки</h2>}<div className="choice-row order-filters" role="group" aria-label="Фильтр заказов">{(customer ? ['all', 'active', 'history'] as const : ['active', 'history'] as const).map((value) => <button type="button" className={`choice ${filter === value ? 'selected' : ''}`} aria-pressed={filter === value} key={value} onClick={() => setFilter(value)} disabled={busy}>{{ all: 'Все', active: 'Активные', history: 'Завершённые' }[value]}</button>)}</div>
            {loading ? <Skeletons/> : visible.length ? <div className="order-list">{visible.map(card)}</div> : <EmptyState title={filter === 'history' ? 'История пока пуста' : 'Заказов пока нет'} action={customer ? <Button variant="secondary" onClick={() => navigate('create')}>Заказать доставку</Button> : refresh}>{filter === 'history' ? 'Завершённые и отменённые доставки сохранятся здесь.' : customer ? 'Создайте первую доставку, чтобы передать посылку.' : 'Ваши принятые доставки появятся здесь.'}</EmptyState>}<SyncTime value={syncedAt} offline={!!syncError}/></>}

          {view === 'create' && customer && <OrderForm draft={draft} onChange={setDraft} onReview={() => navigate('review')} onPoint={(kind) => { setPointKind(kind); setPoint(draft[`${kind}Point`]); navigate('point'); }} busy={busy}/>}
          {view === 'point' && customer && <PointPicker key={pointKind} kind={pointKind} address={draft[`${pointKind}Address`]} point={point} onChange={setPoint}/>}
          {view === 'review' && customer && <OrderReview draft={draft} onEdit={() => navigate('create')} busy={busy}/>}
          {view === 'detail' && (detail ? <OrderDetail order={detail} user={user} onCancel={async () => { if (window.confirm('Отменить этот заказ?')) await props.onMutate(`/api/orders/${detail.id}/status`, { status: 'CANCELLED' }, 'Заказ отменён и сохранён в истории.'); }} busy={busy}/> : <EmptyState title="Заказ больше недоступен" action={<Button variant="secondary" onClick={() => navigate('home')}>К списку заказов</Button>}>Возможно, его уже принял другой курьер. Обновите список и выберите другую доставку.</EmptyState>)}
          {view === 'profile' && <><h1 className="sr-only" tabIndex={-1}>Профиль</h1><div className="profile-card"><span className="avatar large">{initials(user.name)}</span><h2>{user.name}</h2><p className="muted">{customer ? 'Клиент' : 'Курьер'} · {user.telegramId ? 'Telegram' : 'демонстрационный аккаунт'}</p><p>{user.telegramId ? `Telegram ID: ${user.telegramId}` : user.email}</p></div><div className="profile-stats"><div><strong>{activeOrders.length}</strong><span>Активные</span></div><div><strong>{completed.length}</strong><span>Доставлены</span></div></div>
            {user.telegramId && <><Feedback title={customer ? 'Доставляй с Qadam' : 'Доступ курьера открыт'}>{customer ? 'Подай заявку. Администратор проверит её и откроет доступ к заказам.' : 'Принимай заказы и отмечай каждый шаг доставки.'}</Feedback><Button onClick={() => navigate('courierApplication')} disabled={busy}>{customer ? 'Стать курьером' : 'Моя заявка курьера'}</Button></>}
            {user.isAdmin && <><h2>Администрирование</h2><Button variant="secondary" onClick={() => navigate('adminApplications')} disabled={busy}>Заявки курьеров</Button></>}
            <Feedback title="Учебная демонстрация">Используйте тестовые контакты и посылки. Заказы и статусы сохраняются в базе.</Feedback><Button variant="secondary" onClick={() => void props.onSignOut()} disabled={busy}>Выйти из аккаунта</Button></>}
        </div>
      </main>
      {hasFooter && <footer className="sticky-action">{view === 'point' ? <Button className="wide" disabled={!point} onClick={() => { setDraft((current) => ({ ...current, [`${pointKind}Point`]: point })); navigate('create'); }}>Выбрать этот адрес</Button> : view === 'create' ? <Button form="delivery-form" type="submit" className="wide" disabled={busy}>Проверить заказ</Button> : view === 'review' ? <Button className="wide" onClick={() => void confirmOrder()} disabled={busy}>{busy ? 'Сохраняем…' : 'Подтвердить заказ'}</Button> : completedDetail ? <Button className="wide" onClick={history} disabled={busy}>В историю заказов</Button> : actionable && detail ? <Button className="wide" disabled={busy} onClick={() => void (detail.status === 'SEARCHING_FOR_COURIER' ? accept(detail) : advance(detail))}>{busy ? 'Сохраняем…' : detail.status === 'SEARCHING_FOR_COURIER' ? 'Принять заказ' : actionLabels[detail.status]}</Button> : null}</footer>}
      {showNav && <nav className="mobile-nav" aria-label="Мобильная навигация">{navItems.map((item) => <button type="button" key={item.view} className={view === item.view ? 'current' : ''} aria-current={view === item.view ? 'page' : undefined} disabled={busy} onClick={() => navigate(item.view)}><Icon type={item.icon}/><span>{item.label}</span></button>)}</nav>}
    </div>
  </div>;
}

function SyncTime({ value, offline }: { value: string | null; offline: boolean }) {
  return <p className={`sync-time ${offline ? 'offline' : ''}`}>{offline ? 'Нет обновлений · показаны последние полученные данные' : value ? `Обновлено в ${new Intl.DateTimeFormat('ru-KZ', { hour: '2-digit', minute: '2-digit', timeZone: serviceTimezone }).format(new Date(value))}` : 'Подключаемся…'}</p>;
}

function OrderDetail({ order, user, busy, onCancel }: { order: Order; user: User; busy: boolean; onCancel: () => Promise<void> }) {
  const customer = user.role === 'CUSTOMER';
  const complete = order.status === 'DELIVERED';
  const heading = {
    CREATED: 'Заказ создан', SEARCHING_FOR_COURIER: customer ? 'Ищем курьера' : 'Новая доставка',
    ACCEPTED: customer ? 'Курьер назначен' : 'Заберите посылку', PICKED_UP: customer ? 'Посылка у курьера' : 'Посылка у вас',
    IN_TRANSIT: customer ? 'Посылка в пути' : 'Доставьте получателю', DELIVERED: customer ? 'Посылка у получателя' : 'Доставка завершена', CANCELLED: 'Заказ отменён',
  }[order.status];
  return <section className="order-detail" aria-label="Детали заказа">
    {complete ? <div className="success-symbol"><Icon type="check"/></div> : <Badge status={order.status}/>}
    <div className="screen-heading"><h1 tabIndex={-1}>{heading}</h1><p>{complete ? `${orderNumber(order)} · ${formatTime(order.updatedAt)}` : order.status === 'SEARCHING_FOR_COURIER' ? customer ? 'Заказ создан. Курьер увидит адреса и сможет принять доставку.' : 'Проверьте адреса и условия перед принятием заказа.' : `Создан ${formatTime(order.createdAt)}`}</p></div>
    <OrderTracking order={order} user={user}/>
    {customer && order.courierName && <div className="courier-contact"><span className="avatar">{initials(order.courierName)}</span><div><strong>{order.courierName}</strong><small>Ваш курьер · тестовый профиль</small></div></div>}
    <RouteCard pickup={order.pickupAddress} destination={order.destinationAddress}/>
    {!complete && <Recipient order={order}/>}
    <PriceNote/>
    {order.status === 'SEARCHING_FOR_COURIER' && <Feedback title={customer ? 'Можно закрыть приложение' : 'Оплата по согласованию'}>{customer ? 'Заказ сохранён. При следующем открытии загрузим актуальный статус с сервера.' : 'Уточните стоимость и условия до передачи посылки.'}</Feedback>}
    <Timeline order={order}/>
    {complete && <Recipient order={order}/>}
    {complete && <p className="muted">Все изменения сохранены. Заказ останется в истории после повторного открытия.</p>}
    {order.status === 'CANCELLED' && <Feedback tone="warning" title="Доставка отменена">Заказ сохранён в истории. Можно создать новую доставку.</Feedback>}
    {customer && ['CREATED', 'SEARCHING_FOR_COURIER'].includes(order.status) && <Button variant="danger" className="wide" disabled={busy} onClick={() => void onCancel()}>Отменить заказ</Button>}
  </section>;
}

function Recipient({ order }: { order: Order }) {
  return <><section className="recipient-section"><h2>Получатель</h2><p>{order.recipientName}</p><a className="recipient-phone" href={`tel:${order.recipientPhone.replace(/[^+\d]/g, '')}`}><Icon type="phone"/>{order.recipientPhone}</a></section>{order.notes && <section className="parcel-note"><h2>О доставке</h2><p className="pre-wrap">{order.notes}</p></section>}</>;
}
