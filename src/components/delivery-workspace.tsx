'use client';

import { useEffect, useRef, useState } from 'react';
import { actionLabels, nextStatus, type MapPoint, type Order, type User } from '../lib/types';
import { AddressRow, Badge, Brand, Button, EmptyState, Feedback, Icon, OrderCard, PriceNote, RouteCard, Skeletons, Timeline, finished, formatTime, initials, orderNumber } from './delivery-ui';
import { emptyDraft, OrderForm, OrderReview, orderPayload, type OrderDraft } from './order-form';
import { serviceCity, serviceTimezone } from '../lib/service-area';
import { CourierOnboarding, CourierApplicationAdmin } from './courier-onboarding';
import { CourierDirectory } from './courier-directory';
import { AddressPicker, type AddressPickerMode } from './address-picker';
import { CustomerHome } from './customer-home';
import { OrderTracking } from './order-tracking';
import { AdminOrders } from './admin-orders';
import { CourierAvailability } from './courier-availability';
import { PhoneProfilePanel,usePhoneProfile } from './phone-profile';
import { OrderContacts,PaymentChoices,QuoteSummary,SavedOrderPrice,formatMoney } from './order-pricing';
import { useOrderQuote } from './use-order-quote';

type View = 'home' | 'orders' | 'profile' | 'create' | 'review' | 'detail' | 'point' | 'courierApplication' | 'adminApplications' | 'adminOrders' | 'couriers' | 'phone';
type Filter = 'all' | 'active' | 'history';
type Props = {
  user: User; telegram: boolean; orders: Order[]; loading: boolean; busy: boolean; error: string; notice: string;
  syncError: string; syncedAt: string | null; selected: string | null;
  initialScreen?: 'courier' | 'adminApplications' | 'adminOrders'; source?: string;
  initialOrderId?: string; detailOrder?: Order | null; onDetailChange: (id: string | null) => void;
  onSelect: (id: string) => void; onSignOut: () => Promise<void>; onRefresh: () => void; onClearMessages: () => void;
  onMutate: (path: string, body: unknown, success: string) => Promise<boolean>;
  onCreate: (input: ReturnType<typeof orderPayload>) => Promise<boolean>;
};

export function DeliveryWorkspace(props: Props) {
  const { user, orders, loading, busy, error, notice, syncError, syncedAt, selected } = props;
  const [view, setView] = useState<View>(props.initialScreen === 'courier' ? 'courierApplication' : props.initialScreen === 'adminApplications' && user.isAdmin ? 'adminApplications' : props.initialScreen === 'adminOrders' && user.isAdmin && props.initialOrderId ? 'adminOrders' : 'home');
  const [filter, setFilter] = useState<Filter>(user.role === 'CUSTOMER' ? 'all' : 'active');
  const [draft, setDraft] = useState<OrderDraft>({ ...emptyDraft });
  const [pointKind, setPointKind] = useState<'pickup' | 'destination'>('pickup');
  const [point, setPoint] = useState<MapPoint | null>(null);
  const [pointAddress, setPointAddress] = useState('');
  const [pointMode, setPointMode] = useState<AddressPickerMode>('search');
  const [pointOrigin, setPointOrigin] = useState<'home' | 'create'>('home');
  const [pointSequence, setPointSequence] = useState(false);
  const [pointSession, setPointSession] = useState(0);
  const [creatingNew, setCreatingNew] = useState(false);
  const [phoneReturn,setPhoneReturn]=useState<View>('profile');
  const phone=usePhoneProfile(!!user.telegramId);
  const pricing=useOrderQuote(view==='review',draft);
  const bodyRef = useRef<HTMLElement>(null);
  const customer = user.role === 'CUSTOMER';
  const ownOrders = customer ? orders : orders.filter((order) => order.courierId === user.id);
  const activeOrders = ownOrders.filter((order) => !finished(order));
  const completed = ownOrders.filter((order) => order.status === 'DELIVERED');
  const available = orders.filter((order) => order.status === 'SEARCHING_FOR_COURIER' && !order.courierId);
  const visible = ownOrders.filter((order) => filter === 'all' || (filter === 'history' ? finished(order) : !finished(order)));
  const detail = props.detailOrder?.id === selected ? props.detailOrder : orders.find((order) => order.id === selected);
  const openedLink = useRef<string | null>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
    bodyRef.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }, [view, selected, pointKind, pointMode]);

  useEffect(() => {
    setFilter(user.role === 'COURIER' ? 'active' : 'all');
    setView((current) => current === 'courierApplication' || current === 'adminApplications' || current === 'adminOrders' || current === 'couriers' ? current : 'home');
  }, [user.role]);

  useEffect(() => {
    if (!props.initialOrderId || openedLink.current === props.initialOrderId) return;
    openedLink.current = props.initialOrderId;
    setView(props.initialScreen === 'adminOrders' && user.isAdmin ? 'adminOrders' : 'detail');
  }, [props.initialOrderId, props.initialScreen, user.isAdmin]);
  useEffect(() => { props.onDetailChange(view === 'detail' ? selected : null); }, [view, selected, props.onDetailChange]);

  function navigate(target: View) {
    if (busy) return;
    props.onClearMessages();
    setView(target);
  }
  function open(order: Order) { props.onSelect(order.id); navigate('detail'); }
  function history() { setFilter('history'); navigate('orders'); }
  function editAddress(kind: 'pickup' | 'destination', origin: 'home' | 'create', sequence = false) {
    if (busy) return;
    if (origin === 'home') setCreatingNew(true);
    setPointKind(kind); setPoint(draft[`${kind}Point`]); setPointAddress(draft[`${kind}Address`]);
    setPointMode('search'); setPointOrigin(origin); setPointSequence(sequence); setPointSession((value) => value + 1);
    navigate('point');
  }
  function continueDraft() {
    if (draft.pickupAddress.trim().length < 5) editAddress('pickup', 'home', true);
    else if (draft.destinationAddress.trim().length < 5) editAddress('destination', 'home', true);
    else navigate('create');
  }
  function newDelivery() { setCreatingNew(true); navigate('home'); }
  function confirmAddress() {
    if (busy || pointAddress.trim().length < 5 || pointAddress.trim().length > 200 || (pointMode === 'map' && !point)) return;
    setDraft((current) => ({ ...current, [`${pointKind}Point`]: point, [`${pointKind}Address`]: pointAddress.trim() }));
    if (pointSequence && pointKind === 'pickup' && draft.destinationAddress.trim().length < 5) editAddress('destination', pointOrigin, true);
    else navigate(pointOrigin);
  }
  function back() {
    if(view==='phone'){navigate(phoneReturn);return;}
    if (view === 'point' && pointMode === 'map') { setPointMode('search'); return; }
    navigate(view === 'point' ? pointOrigin : view === 'review' ? 'create' : 'home');
  }
  async function accept(order: Order) {
    if(order.pricing&&!phone.profile.phoneVerified){props.onSelect(order.id);setPhoneReturn('detail');navigate('phone');return;}
    if (await props.onMutate(`/api/orders/${order.id}/accept`, {shareContact:true}, 'Заказ принят. Заберите посылку у отправителя.')) setView('detail');
  }
  async function advance(order: Order) {
    const target = nextStatus[order.status];
    if (target) await props.onMutate(`/api/orders/${order.id}/status`, { status: target }, target === 'DELIVERED' ? 'Доставка завершена. Заказ сохранён в истории.' : 'Статус обновлён. Клиент увидит изменение автоматически.');
  }
  async function confirmOrder() {
    if(!pricing.ready)return;
    if(pricing.enabled&&!phone.profile.phoneVerified){setPhoneReturn('review');navigate('phone');return;}
    if (await props.onCreate(orderPayload(draft,pricing.enabled?pricing.quote?.id:undefined))) { setDraft({ ...emptyDraft }); setCreatingNew(false); setView('detail'); }
  }
  const actionable = view === 'detail' && detail && !customer && (detail.status === 'SEARCHING_FOR_COURIER' || (detail.courierId === user.id && nextStatus[detail.status]));
  const completedDetail = view === 'detail' && detail && finished(detail);
  const hasFooter = view === 'create' || view === 'review' || view === 'point' || view==='phone' || !!actionable || !!completedDetail;
  const showNav = view === 'home' || view === 'orders' || view === 'profile';
  const title = view === 'phone' ? 'Телефон для связи' : view === 'point' ? pointMode === 'map' ? `Уточните точку ${pointKind === 'pickup' ? 'А' : 'Б'}` : pointKind === 'pickup' ? 'Откуда забрать?' : 'Куда доставить?' : view === 'home' ? customer ? serviceCity : 'Заказы рядом' : view === 'orders' ? 'Мои заказы' : view === 'profile' ? 'Профиль' : view === 'create' ? 'Получатель и посылка' : view === 'review' ? 'Проверка заказа' : detail ? `Заказ ${orderNumber(detail)}` : 'Заказ недоступен';
  const navItems: { view: View; label: string; icon: 'box' | 'clock' | 'person' }[] = [
    { view: 'home', label: customer ? 'Доставка' : 'Доступные', icon: 'box' },
    { view: 'orders', label: customer ? 'Заказы' : 'Мои заказы', icon: 'clock' },
    { view: 'profile', label: 'Профиль', icon: 'person' },
  ];
  const card = (order: Order) => <OrderCard key={order.id} order={order} busy={busy} onOpen={() => open(order)}/>;
  const refresh = <Button variant="secondary" onClick={props.onRefresh} disabled={busy}>Обновить список</Button>;

  if (view === 'courierApplication') return <CourierOnboarding user={user} source={props.source} onBack={() => navigate('profile')} onOrders={() => { props.onRefresh(); navigate('home'); }}/>;
  if (view === 'couriers') return <CourierDirectory user={user} onBack={() => navigate('profile')}/>;
  if (view === 'adminApplications') return <CourierApplicationAdmin user={user} onBack={() => navigate('profile')}/>;
  if (view === 'adminOrders') return <AdminOrders user={user} initialOrderId={props.initialOrderId} onBack={() => navigate('profile')}/>;

  return <div className="app-shell">
    <aside className="sidebar"><Brand/><div className="sidebar-role">{customer ? 'Клиент' : 'Курьер'} · {serviceCity}</div>
      <nav aria-label="Разделы">{navItems.map((item) => <button type="button" key={item.view} aria-label={item.view === 'orders' ? 'Мои заказы' : item.label} className={`sidebar-link ${view === item.view ? 'current' : ''}`} aria-current={view === item.view ? 'page' : undefined} onClick={() => navigate(item.view)} disabled={busy}><Icon type={item.icon}/>{item.view === 'orders' ? 'Мои заказы' : item.label}{item.view === 'orders' && activeOrders.length > 0 && <span className="nav-count" aria-hidden="true">{activeOrders.length}</span>}</button>)}</nav>
      <div className="sidebar-account"><span className="avatar">{initials(user.name)}</span><div><strong>{user.name}</strong><small>{customer ? 'Клиент' : 'Курьер'}</small></div></div>
    </aside>
    <div className={`workspace ${hasFooter ? 'with-action' : ''} ${showNav ? 'with-nav' : ''} ${customer && view === 'home' ? 'workspace-customer-home' : ''}`}>
      <header className="product-header"><span className="product-header-mark"><Icon type="box"/></span><span>Qadam Delivery</span>{!props.telegram && <button type="button" className="icon-button" aria-label="Выйти" title="Выйти" onClick={() => void props.onSignOut()} disabled={busy}><Icon type="logout"/></button>}</header>
      {!(view === 'home' && customer) && <div className={`app-bar ${view === 'point' ? 'address-app-bar' : ''}`}>{view === 'home' ? <span className="app-bar-city"><Icon type="pin"/></span> : <button type="button" className="icon-button" aria-label="Назад" disabled={busy} onClick={back}><Icon type="back"/></button>}<p>{title}</p><span className="app-bar-balance"/></div>}
      <main className={`screen-body screen-${view}`} ref={bodyRef} id="main-content">
        <div className="screen-content">
          {error && <Feedback tone="error" title={error} role="alert" action={<button type="button" className="feedback-dismiss" aria-label="Закрыть сообщение" onClick={props.onClearMessages}>×</button>}/>}
          {notice && <Feedback tone="success" title={notice} role="status"/>}
          {syncError && <Feedback tone="error" title="Данные не обновлены" role="alert" action={<button type="button" className="text-button" onClick={props.onRefresh}>Повторить</button>}>{syncError}{syncedAt && <p>Последнее обновление: {formatTime(syncedAt)}. Статусы могут быть устаревшими.</p>}</Feedback>}

          {view === 'home' && customer && <CustomerHome draft={draft} activeOrders={activeOrders} creatingNew={creatingNew} loading={loading} busy={busy} onAddress={(kind) => editAddress(kind, 'home')} onParcel={(parcelType) => setDraft((current) => ({ ...current, parcelType }))} onContinue={continueDraft} onNew={newDelivery} onOpen={open} onOrders={() => { setFilter('active'); navigate('orders'); }}/>}

          {view === 'home' && !customer && <><CourierAvailability telegram={props.telegram}/><div className="screen-heading"><h1 tabIndex={-1}>Можно принять</h1><p>Доступные заказы. Условия доставки уточняются до начала заказа.</p></div><p className="city-label"><Icon type="locate"/>{serviceCity}</p>
            {activeOrders.length > 0 && <Button variant="secondary" onClick={() => { setFilter('active'); navigate('orders'); }} disabled={busy}>Мои активные доставки · {activeOrders.length}</Button>}
            {loading ? <Skeletons/> : available.length ? <div className="order-list courier-list">{available.map((order) => <OrderCard key={order.id} order={order} onOpen={() => open(order)} onAccept={() => void accept(order)} busy={busy}/>)}</div> : <EmptyState title="Пока нет заказов" action={refresh}>Новые доставки появятся в этом списке. Можно обновить его вручную.</EmptyState>}
            <SyncTime value={syncedAt} offline={!!syncError}/></>}

          {view === 'orders' && <><h1 className="sr-only" tabIndex={-1}>Мои заказы</h1>{!customer && <h2 className="list-title">Ваши доставки</h2>}<div className="choice-row order-filters" role="group" aria-label="Фильтр заказов">{(customer ? ['all', 'active', 'history'] as const : ['active', 'history'] as const).map((value) => <button type="button" className={`choice ${filter === value ? 'selected' : ''}`} aria-pressed={filter === value} key={value} onClick={() => setFilter(value)} disabled={busy}>{{ all: 'Все', active: 'Активные', history: 'Завершённые' }[value]}</button>)}</div>
            {loading ? <Skeletons/> : visible.length ? <div className="order-list">{visible.map(card)}</div> : <EmptyState title={filter === 'history' ? 'История пока пуста' : 'Заказов пока нет'} action={customer ? <Button variant="secondary" onClick={newDelivery}>Заказать доставку</Button> : refresh}>{filter === 'history' ? 'Завершённые и отменённые доставки сохранятся здесь.' : customer ? 'Создайте первую доставку, чтобы передать посылку.' : 'Ваши принятые доставки появятся здесь.'}</EmptyState>}<SyncTime value={syncedAt} offline={!!syncError}/></>}

          {view === 'create' && customer && <OrderForm draft={draft} onChange={setDraft} onReview={() => navigate('review')} onPoint={(kind) => editAddress(kind, 'create')} busy={busy}/>}
          {view === 'point' && customer && <AddressPicker key={pointSession} kind={pointKind} address={draft[`${pointKind}Address`]} pickupAddress={draft.pickupAddress} point={point} onChange={setPoint} onAddress={setPointAddress} mode={pointMode} onModeChange={setPointMode}/>}
          {view === 'review' && customer && <OrderReview draft={draft} onEdit={() => navigate('create')} busy={busy} pricing={<>
            {pricing.enabled===false?<PriceNote/>:<><p className="muted">Автомобиль</p><QuoteSummary quote={pricing.quote} previousPrice={pricing.previousPrice} busy={pricing.busy} error={pricing.error} onRetry={pricing.retry} onExpired={pricing.expire}/></>}
            <PaymentChoices payer={draft.payer} paymentMethod={draft.paymentMethod} disabled={busy} onChange={(field,value)=>setDraft(current=>({...current,[field]:value}))}/>
            <p className="muted">Подтверждённый номер из Telegram будет доступен курьеру после принятия заказа.{pricing.enabled&&!phone.profile.phoneVerified?' Перед созданием подтвердите свой номер для связи.':''}</p>
          </>}/>}
          {view==='phone'&&<PhoneProfilePanel profile={phone.profile} busy={phone.busy} notice={phone.notice}/>}
          {view === 'detail' && (detail ? <OrderDetail order={detail} user={user} onCancel={async () => { if (window.confirm('Отменить этот заказ?')) await props.onMutate(`/api/orders/${detail.id}/status`, { status: 'CANCELLED' }, 'Заказ отменён и сохранён в истории.'); }} busy={busy}/> : <EmptyState title="Заказ больше недоступен" action={<Button variant="secondary" onClick={() => navigate('home')}>К списку заказов</Button>}>Возможно, его уже принял другой курьер. Обновите список и выберите другую доставку.</EmptyState>)}
          {view === 'profile' && <><h1 className="sr-only" tabIndex={-1}>Профиль</h1><div className="profile-card"><span className="avatar large">{initials(user.name)}</span><h2>{user.name}</h2><p className="muted">{customer ? 'Клиент' : 'Курьер'}{user.telegramId && ' · Telegram'}</p><p>{user.telegramId ? `Telegram ID: ${user.telegramId}` : user.email}</p></div><div className="profile-stats"><div><strong>{activeOrders.length}</strong><span>Активные</span></div><div><strong>{completed.length}</strong><span>Доставлены</span></div></div>
            {user.telegramId&&<Button variant="secondary" onClick={()=>{setPhoneReturn('profile');navigate('phone');}}>Мой телефон</Button>}
            {user.telegramId && <><Feedback title={customer ? 'Доставляй с Qadam' : 'Доступ курьера открыт'}>{customer ? 'Подай заявку. Администратор проверит её и откроет доступ к заказам.' : 'Принимай заказы и отмечай каждый шаг доставки.'}</Feedback><Button onClick={() => navigate('courierApplication')} disabled={busy}>{customer ? 'Стать курьером' : 'Моя заявка курьера'}</Button></>}
            {user.isAdmin && <><h2>Администрирование</h2><Button variant="secondary" onClick={() => navigate('adminOrders')} disabled={busy}>Все заказы</Button><Button variant="secondary" onClick={() => navigate('adminApplications')} disabled={busy}>Заявки курьеров</Button><Button variant="secondary" onClick={() => navigate('couriers')} disabled={busy}>Курьеры</Button></>}
            {!props.telegram && <Button variant="secondary" onClick={() => void props.onSignOut()} disabled={busy}>Выйти из аккаунта</Button>}</>}
        </div>
      </main>
      {hasFooter && <footer key={view} className={`sticky-action ${view === 'point' ? 'address-action' : ''}`}>{view==='phone'?<Button className="wide" disabled={phone.busy} onClick={()=>phone.profile.phoneVerified?navigate(phoneReturn):void phone.request()}>{phone.busy?'Проверяем номер…':phone.profile.phoneVerified?'Вернуться к заказу':'Поделиться номером'}</Button>:view === 'point' ? <Button className="wide" disabled={busy || pointAddress.trim().length < 5 || pointAddress.trim().length > 200 || (pointMode === 'map' && !point)} onClick={confirmAddress}>{pointMode === 'map' ? 'Подтвердить точку' : 'Выбрать адрес'}</Button> : view === 'create' ? <Button form="delivery-form" type="submit" className="wide" disabled={busy}>Проверить заказ</Button> : view === 'review' ? <Button className="wide" onClick={() => void confirmOrder()} disabled={busy||!pricing.ready}>{busy ? 'Сохраняем…' : pricing.enabled?phone.profile.phoneVerified?`Создать заказ за ${formatMoney(pricing.quote?.priceKzt??0)}`:'Подтвердить телефон':'Подтвердить заказ'}</Button> : completedDetail ? <Button className="wide" onClick={history} disabled={busy}>В историю заказов</Button> : actionable && detail ? <Button className="wide" disabled={busy} onClick={() => void (detail.status === 'SEARCHING_FOR_COURIER' ? accept(detail) : advance(detail))}>{busy ? 'Сохраняем…' : detail.status === 'SEARCHING_FOR_COURIER' ? detail.pricing?`Принять · ${formatMoney(detail.pricing.courierPayoutKzt)}`:'Принять заказ' : actionLabels[detail.status]}</Button> : null}</footer>}
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
    {customer && order.courierName && <div className="courier-contact"><span className="avatar">{initials(order.courierName)}</span><div><strong>{order.courierName}</strong><small>Ваш курьер</small></div></div>}
    <RouteCard pickup={order.pickupAddress} destination={order.destinationAddress}/>
    {!complete && <Recipient order={order}/>}
    <SavedOrderPrice order={order} courier={!customer}/>
    <OrderContacts order={order} customer={customer}/>
    {!customer&&order.status==='SEARCHING_FOR_COURIER'&&<p className="muted">Принимая заказ, вы разрешаете показать свой подтверждённый номер клиенту для связи по доставке.</p>}
    {order.status === 'SEARCHING_FOR_COURIER' && <Feedback title={customer ? 'Можно закрыть приложение' : order.pricing?'Цена зафиксирована':'Оплата по согласованию'}>{customer ? 'Заказ сохранён. При следующем открытии загрузим актуальный статус с сервера.' : order.pricing?'Вся стоимость доставки причитается курьеру. Способ и момент расчёта уточните со сторонами.':'Уточните стоимость и условия до передачи посылки.'}</Feedback>}
    <Timeline order={order}/>
    {complete && <Recipient order={order}/>}
    {complete && <p className="muted">Все изменения сохранены. Заказ останется в истории после повторного открытия.</p>}
    {order.status === 'CANCELLED' && <Feedback tone="warning" title="Доставка отменена">Заказ сохранён в истории. Можно создать новую доставку.</Feedback>}
    {customer && ['CREATED', 'SEARCHING_FOR_COURIER'].includes(order.status) && <Button variant="danger" className="wide" disabled={busy} onClick={() => void onCancel()}>Отменить заказ</Button>}
  </section>;
}

function Recipient({ order }: { order: Order }) {
  return <><section className="recipient-section"><h2>Получатель</h2>{order.recipientName && order.recipientPhone ? <><p>{order.recipientName}</p><a className="recipient-phone" href={`tel:${order.recipientPhone.replace(/[^+\d]/g, '')}`}><Icon type="phone"/>{order.recipientPhone}</a></> : <p className="muted">Контакты получателя откроются после принятия заказа</p>}</section>{order.notes && <section className="parcel-note"><h2>О доставке</h2><p className="pre-wrap">{order.notes}</p></section>}</>;
}
