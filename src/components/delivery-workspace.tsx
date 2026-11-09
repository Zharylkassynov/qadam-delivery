'use client';

import { useEffect, useRef, useState } from 'react';
import { actionLabels, nextStatus, type MapPoint, type Order, type User } from '../lib/types';
import { AddressRow, Badge, Brand, Button, EmptyState, Feedback, Icon, OrderCard, PriceNote, RouteCard, Skeletons, Timeline, finished, formatTime, initials, orderNumber } from './delivery-ui';
import { emptyDraft, OrderForm, OrderReview, orderPayload, repeatDraft,type OrderDraft } from './order-form';
import { serviceCity, serviceTimezone } from '../lib/service-area';
import { CourierOnboarding, CourierApplicationAdmin } from './courier-onboarding';
import { CourierDirectory } from './courier-directory';
import { AddressPicker, type AddressPickerMode } from './address-picker';
import { CustomerHome } from './customer-home';
import { OrderTracking } from './order-tracking';
import {RecipientShare} from './recipient-sharing';
import { AdminOrders } from './admin-orders';
import { CourierAvailability } from './courier-availability';
import { PhoneProfilePanel,usePhoneProfile } from './phone-profile';
import { OrderContacts,PaymentChoices,QuoteSummary,SavedOrderPrice,formatMoney } from './order-pricing';
import { deliveryPilot } from '../lib/delivery-pilot';
import { useOrderQuote } from './use-order-quote';
import { PhoneLink } from './phone-link';
import { useBusinessProfile,BusinessProfilePanel,emptyBusiness,type BusinessDraft } from './business-profile';
import { OrderRequirements } from './order-requirements';
import { windowExpired,futurePriceMessage } from '../lib/order-details';
import {api} from '../lib/client-api';
import {OrderTrustPanel} from './order-trust';
import {CourierRelease,DeliveryHandoff} from './delivery-handoff';
import {OrderLocationStream} from './order-location-stream';
import {useCourierPresence} from './courier-presence';
import {confirmAction} from '../lib/telegram-ui';
import {CourierHomeScreen} from './telegram-shell';
import {freshLocation} from '../lib/geo-distance';

type View = 'home' | 'orders' | 'profile' | 'create' | 'review' | 'detail' | 'handoff' | 'point' | 'courierApplication' | 'adminApplications' | 'adminOrders' | 'couriers' | 'phone' | 'business';
type Filter = 'all' | 'active' | 'history';
type Props = {
  user: User; telegram: boolean; orders: Order[]; loading: boolean; busy: boolean; error: string; notice: string;
  syncError: string; syncedAt: string | null; selected: string | null;
  initialScreen?: 'courier' | 'adminApplications' | 'adminOrders'; source?: string;
  initialOrderId?: string; detailOrder?: Order | null; onDetailChange: (id: string | null) => void;
  onSelect: (id: string) => void; onSignOut: () => Promise<void>; onRefresh: () => void; onClearMessages: () => void;
  onMutate: (path: string, body: unknown, success: string) => Promise<boolean>;
  onCreate: (input: ReturnType<typeof orderPayload>) => Promise<boolean>;
  shortDeliveries: boolean; onShortDeliveries: (short: boolean) => void;
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
  const [pointOrigin, setPointOrigin] = useState<'home' | 'create' | 'business'>('home');
  const [pointSequence, setPointSequence] = useState(false);
  const [pointSession, setPointSession] = useState(0);
  const [creatingNew, setCreatingNew] = useState(false);
  const [phoneReturn,setPhoneReturn]=useState<View>('profile');
  const phone=usePhoneProfile(!!user.telegramId);
  const business=useBusinessProfile(user.role==='CUSTOMER');
  const [businessDraft,setBusinessDraft]=useState<BusinessDraft>({...emptyBusiness});
  const [businessMode,setBusinessMode]=useState<'view'|'edit'|'delete'>('view');
  const [businessValidation,setBusinessValidation]=useState('');
  const [pickupSource,setPickupSource]=useState<'auto'|'shop'|'other'|'repeat'>('auto');
  const [repeated,setRepeated]=useState(false);
  const [proofEnabled,setProofEnabled]=useState<boolean|null>(null),[proofError,setProofError]=useState(''),[proofRetry,setProofRetry]=useState(0);
  useEffect(()=>{let alive=true;const controller=new AbortController();void api<{enabled:boolean}>('/api/delivery-proof',undefined,controller.signal).then(data=>{if(alive){setProofEnabled(data.enabled);setProofError('');}}).catch(e=>{if(alive)setProofError(e instanceof Error?e.message:'Не удалось проверить условия вручения.');});return()=>{alive=false;controller.abort();};},[proofRetry]);
  const pricing=useOrderQuote(view==='review',draft);
  const needsPhone=(pricing.enabled===true||!!draft.businessName||draft.surprise)&&!phone.profile.phoneVerified;
  const bodyRef = useRef<HTMLElement>(null);
  const customer = user.role === 'CUSTOMER';
  const courierPresence=useCourierPresence();
  const ownOrders = customer ? orders : orders.filter((order) => order.courierId === user.id);
  const activeOrders = ownOrders.filter((order) => !finished(order));
  useEffect(()=>{if(!customer)void courierPresence.load();},[customer,activeOrders.length,courierPresence.load]);
  const completed = ownOrders.filter((order) => order.status === 'DELIVERED');
  const available = orders.filter((order) => order.status === 'SEARCHING_FOR_COURIER' && !order.courierId);
  const visible = ownOrders.filter((order) => filter === 'all' || (filter === 'history' ? finished(order) : !finished(order)));
  const detail = props.detailOrder?.id === selected ? props.detailOrder : orders.find((order) => order.id === selected);
  const openedLink = useRef<string | null>(null);
  useEffect(()=>{
    if(pickupSource!=='auto'||!business.profile)return;
    const p=business.profile;
    setDraft(current=>current.pickupAddress||current.destinationAddress?current:{...current,pickupAddress:p.pickupAddress,pickupPoint:p.pickupPoint,pickupDetails:p.pickupDetails,businessName:p.name});
  },[business.profile,pickupSource]);

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
  useEffect(() => { props.onDetailChange(view === 'detail'||view==='handoff' ? selected : null); }, [view, selected, props.onDetailChange]);
  useEffect(()=>{if(view==='handoff'&&detail&&(detail.courierId!==user.id||detail.status!=='IN_TRANSIT'))setView('detail');},[view,detail?.courierId,detail?.status,user.id]);

  function navigate(target: View) {
    if (busy||business.busy) return;
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
  function businessAddress(){
    setPointKind('pickup');setPoint(businessDraft.pickupPoint);setPointAddress(businessDraft.pickupAddress);setPointOrigin('business');setPointMode('search');setPointSequence(false);setPointSession(n=>n+1);navigate('point');
  }
  function changeBusinessMode(mode:'view'|'edit'|'delete'){
    if(mode==='edit'){const p=business.profile;setBusinessDraft(p?{name:p.name,pickupAddress:p.pickupAddress,pickupPoint:p.pickupPoint,pickupDetails:p.pickupDetails}:{...emptyBusiness});}
    setBusinessValidation('');setBusinessMode(mode);
  }
  async function saveBusiness(){
    if(businessDraft.name.trim().length<2||businessDraft.name.trim().length>100||businessDraft.pickupAddress.trim().length<5||!businessDraft.pickupPoint){setBusinessValidation('Укажите название от 2 символов, адрес и подтвердите точку входа на карте.');return;}
    setBusinessValidation('');
    if(!phone.profile.phoneVerified){setPhoneReturn('business');navigate('phone');return;}
    if(await business.save(businessDraft))setBusinessMode('view');
  }
  function chooseSource(shop:boolean){
    const p=business.profile;if(shop&&!p)return;
    setPickupSource(shop?'shop':'other');
    setDraft(current=>({...current,pickupAddress:shop?p!.pickupAddress:'',pickupPoint:shop?p!.pickupPoint:null,businessName:shop?p!.name:null,pickupDetails:shop?p!.pickupDetails:'',pilotParcelConfirmed:false}));
  }
  function continueDraft() {
    if (draft.pickupAddress.trim().length < 5) editAddress('pickup', 'home', true);
    else if (draft.destinationAddress.trim().length < 5) editAddress('destination', 'home', true);
    else navigate('create');
  }
  function newDelivery() {const p=business.profile;setRepeated(false);setPickupSource(p?'shop':'other');setDraft({...emptyDraft,...(p?{pickupAddress:p.pickupAddress,pickupPoint:p.pickupPoint,pickupDetails:p.pickupDetails,businessName:p.name}:{})});setCreatingNew(true);navigate('home');}
  function repeat(order:Order){setDraft(repeatDraft(order));setPickupSource('repeat');setRepeated(true);setCreatingNew(true);navigate('create');}
  function confirmAddress() {
    if (busy || pointAddress.trim().length < 5 || pointAddress.trim().length > 200 || (pointMode === 'map' && !point)) return;
    if(pointOrigin==='business'){if(!point){setBusinessValidation('Выберите точку входа на карте.');return;}setBusinessDraft(current=>({...current,pickupPoint:point,pickupAddress:pointAddress.trim()}));navigate('business');return;}
    if(pointKind==='pickup')setPickupSource('other');
    setDraft((current) => ({ ...current, [`${pointKind}Point`]: point, [`${pointKind}Address`]: pointAddress.trim(),pilotParcelConfirmed:false,...(pointKind==='pickup'?{businessName:null,pickupDetails:''}:{}) }));
    if (pointSequence && pointKind === 'pickup' && draft.destinationAddress.trim().length < 5) editAddress('destination', pointOrigin, true);
    else navigate(pointOrigin);
  }
  function back() {
    if(view==='phone'){navigate(phoneReturn);return;}
    if (view === 'point' && pointMode === 'map') { setPointMode('search'); return; }
    navigate(view === 'point' ? pointOrigin : view === 'review' ? 'create' : view==='business'?'profile':'home');
  }
  async function accept(order: Order) {
    if(order.pricing&&!phone.profile.phoneVerified){props.onSelect(order.id);setPhoneReturn('detail');navigate('phone');return;}
    if (await props.onMutate(`/api/orders/${order.id}/accept`, {shareContact:true}, 'Заказ принят. Заберите посылку у отправителя.')) setView('detail');
  }
  async function advance(order: Order) {
    const target = nextStatus[order.status];
    if(target==='DELIVERED'&&(proofEnabled||order.photoRequired||order.codeRequired)){navigate('handoff');return;}
    if (target) await props.onMutate(`/api/orders/${order.id}/status`, { status: target }, target === 'DELIVERED' ? 'Доставка завершена. Заказ сохранён в истории.' : 'Статус обновлён. Клиент увидит изменение автоматически.');
  }
  async function confirmOrder() {
    if(!pricing.ready||proofEnabled===null||proofError)return;
    if(needsPhone){setPhoneReturn('review');navigate('phone');return;}
    if (await props.onCreate(orderPayload(draft,pricing.enabled?pricing.quote?.id:undefined))) {setPickupSource('auto');setRepeated(false);setDraft({ ...emptyDraft }); setCreatingNew(false); setView('detail'); }
  }
  const actionable = view === 'detail' && detail && !customer && (detail.status === 'SEARCHING_FOR_COURIER' || (detail.courierId === user.id && nextStatus[detail.status]));
  const completedDetail = view === 'detail' && detail && finished(detail);
  const hasFooter = view === 'create' || view === 'review' || view === 'point' || view==='phone' || view==='business' || !!actionable || !!completedDetail;
  const showNav = view === 'home' || view === 'orders' || view === 'profile';
  const title = view==='business'?'Мой магазин':view === 'phone' ? 'Телефон для связи' : view === 'point' ? pointMode === 'map' ? `Уточните точку ${pointKind === 'pickup' ? 'А' : 'Б'}` : pointKind === 'pickup' ? 'Откуда забрать?' : 'Куда доставить?' : view === 'home' ? customer ? serviceCity : 'Заказы рядом' : view === 'orders' ? 'Мои заказы' : view === 'profile' ? 'Профиль' : view === 'create' ? 'Получатель и посылка' : view === 'review' ? 'Проверка заказа' : detail ? `Заказ ${orderNumber(detail)}` : 'Заказ недоступен';
  const navItems: { view: View; label: string; icon: 'box' | 'clock' | 'person' }[] = [
    { view: 'home', label: customer ? 'Доставка' : 'Доступные', icon: 'box' },
    { view: 'orders', label: customer ? 'Заказы' : 'Мои заказы', icon: 'clock' },
    { view: 'profile', label: 'Профиль', icon: 'person' },
  ];
  const card = (order: Order) => <OrderCard key={order.id} order={order} busy={busy} onOpen={() => open(order)} onRepeat={customer&&finished(order)?()=>repeat(order):undefined}/>;
  const refresh = <Button variant="secondary" onClick={props.onRefresh} disabled={busy}>Обновить список</Button>;

  if (view === 'courierApplication') return <CourierOnboarding user={user} source={props.source} onBack={() => navigate('profile')} onOrders={() => { props.onRefresh(); navigate('home'); }}/>;
  if (view === 'couriers') return <CourierDirectory user={user} onBack={() => navigate('profile')}/>;
  if (view === 'adminApplications') return <CourierApplicationAdmin user={user} onBack={() => navigate('profile')}/>;
  if (view === 'adminOrders') return <AdminOrders user={user} initialOrderId={props.initialOrderId} onBack={() => navigate('profile')}/>;
  if(view==='handoff'&&detail&&detail.courierId===user.id&&detail.status==='IN_TRANSIT')return <DeliveryHandoff key={`${detail.id}:${detail.assignmentVersion}`} order={detail} busy={busy} error={error} onBack={()=>navigate('detail')} onComplete={async body=>{const ok=await props.onMutate(`/api/orders/${detail.id}/complete`,body,'Доставка завершена. Подтверждение сохранено.');if(ok)setView('detail');return ok;}}/>;

  return <div className="app-shell">
    <aside className="sidebar"><Brand/><div className="sidebar-role">{customer ? 'Клиент' : 'Курьер'} · {serviceCity}</div>
      <nav aria-label="Разделы">{navItems.map((item) => <button type="button" key={item.view} aria-label={item.view === 'orders' ? 'Мои заказы' : item.label} className={`sidebar-link ${view === item.view ? 'current' : ''}`} aria-current={view === item.view ? 'page' : undefined} onClick={() => navigate(item.view)} disabled={busy}><Icon type={item.icon}/>{item.view === 'orders' ? 'Мои заказы' : item.label}{item.view === 'orders' && activeOrders.length > 0 && <span className="nav-count" aria-hidden="true">{activeOrders.length}</span>}</button>)}</nav>
      <div className="sidebar-account"><span className="avatar">{initials(user.name)}</span><div><strong>{user.name}</strong><small>{customer ? 'Клиент' : 'Курьер'}</small></div></div>
    </aside>
    <div className={`workspace ${hasFooter ? 'with-action' : ''} ${showNav ? 'with-nav' : ''} ${customer && view === 'home' ? 'workspace-customer-home' : ''}`}>
      <header className="product-header"><span className="product-header-mark"><Icon type="box"/></span><span>Qadam Delivery</span>{!props.telegram && <button type="button" className="icon-button" aria-label="Выйти" title="Выйти" onClick={() => void props.onSignOut()} disabled={busy}><Icon type="logout"/></button>}</header>
      {!(view === 'home' && customer) && <div data-telegram-root={showNav||undefined} className={`app-bar ${view === 'point' ? 'address-app-bar' : ''}`}>{view === 'home' ? <span className="app-bar-city"><Icon type="pin"/></span> : <button data-telegram-back={!showNav||undefined} type="button" className="icon-button" aria-label="Назад" disabled={busy} onClick={back}><Icon type="back"/></button>}<p>{title}</p><span className="app-bar-balance"/></div>}
      <main className={`screen-body screen-${view}`} ref={bodyRef} id="main-content">
        <div className="screen-content">
          {error && <Feedback tone="error" title={error} role="alert" action={<button type="button" className="feedback-dismiss" aria-label="Закрыть сообщение" onClick={props.onClearMessages}>×</button>}/>}
          {notice && <Feedback tone="success" title={notice} role="status"/>}
          {syncError && <Feedback tone="error" title="Данные не обновлены" role="alert" action={<button type="button" className="text-button" onClick={props.onRefresh}>Повторить</button>}>{syncError}{syncedAt && <p>Последнее обновление: {formatTime(syncedAt)}. Статусы могут быть устаревшими.</p>}</Feedback>}
          {user.courierBlocked&&<Feedback title="Курьерский доступ ограничен" tone="warning">Личные доставки доступны. Если у вас уже есть принятая посылка, свяжитесь с командой Qadam: <a href="https://t.me/zharlkssnv" target="_blank" rel="noopener noreferrer">@zharlkssnv</a>.</Feedback>}

          {view === 'home' && customer && <CustomerHome draft={draft} activeOrders={activeOrders} creatingNew={creatingNew} loading={loading} busy={busy} business={business.profile} onSource={chooseSource} onAddress={(kind) => editAddress(kind, 'home')} onParcel={(parcelType) => setDraft((current) => ({ ...current, parcelType,pilotParcelConfirmed:false }))} onContinue={continueDraft} onNew={newDelivery} onOpen={open} onOrders={() => { setFilter('active'); navigate('orders'); }}/>}

          {view === 'home' && !customer && <><CourierAvailability telegram={props.telegram}/><div className="screen-heading"><h1 tabIndex={-1}>Можно принять</h1><p>Доступные заказы. Условия доставки уточняются до начала заказа.</p></div><p className="city-label"><Icon type="locate"/>{serviceCity}</p>
            {activeOrders.length > 0 && <Button variant="secondary" onClick={() => { setFilter('active'); navigate('orders'); }} disabled={busy}>Мои активные доставки · {activeOrders.length}</Button>}
            {courierPresence.status?.transport==='FOOT'&&<><div className="choice-row" role="group" aria-label="Длина доставки"><button type="button" className={`choice ${props.shortDeliveries?'selected':''}`} aria-pressed={props.shortDeliveries} onClick={()=>props.onShortDeliveries(true)}>Короткие</button><button type="button" className={`choice ${!props.shortDeliveries?'selected':''}`} aria-pressed={!props.shortDeliveries} onClick={()=>props.onShortDeliveries(false)}>Все</button></div><p className="field-hint">{props.shortDeliveries?'До 4 км от А до Б по прямой. Пеший маршрут может быть длиннее. Заказы без точек остаются в списке.':'Все доступные доставки, включая заказы без точек на карте.'}</p></>}
            <p className="courier-queue-hint">{courierPresence.status?.online&&courierPresence.status.locationSharing&&courierPresence.status.consentCurrent&&freshLocation(courierPresence.status.location)?'Сначала ближе к забору, с учётом времени и срочности.':'Нет свежей позиции. Расстояние до забора пока не определено.'}</p>
            {loading ? <Skeletons/> : available.length ? <div className="order-list courier-list">{available.map((order) => <OrderCard key={order.id} order={order} onOpen={() => open(order)} onAccept={() => void accept(order)} busy={busy} distances={{pickupM:courierPresence.status?.online&&courierPresence.status.locationSharing&&courierPresence.status.consentCurrent&&freshLocation(courierPresence.status.location)?order.pickupDistanceM??null:null,deliveryM:order.deliveryDistanceM??null}}/>)}</div> : <EmptyState title={courierPresence.status?.transport==='FOOT'&&props.shortDeliveries?'Коротких доставок пока нет':'Пока нет заказов'} action={<>{courierPresence.status?.transport==='FOOT'&&props.shortDeliveries&&<Button variant="secondary" onClick={()=>props.onShortDeliveries(false)}>Посмотреть все заказы</Button>}{refresh}</>}>Новые доставки появятся в этом списке. Можно обновить его вручную.</EmptyState>}
            <SyncTime value={syncedAt} offline={!!syncError}/></>}

          {view === 'orders' && <><h1 className="sr-only" tabIndex={-1}>Мои заказы</h1>{!customer && <h2 className="list-title">Ваши доставки</h2>}<div className="choice-row order-filters" role="group" aria-label="Фильтр заказов">{(customer ? ['all', 'active', 'history'] as const : ['active', 'history'] as const).map((value) => <button type="button" className={`choice ${filter === value ? 'selected' : ''}`} aria-pressed={filter === value} key={value} onClick={() => setFilter(value)} disabled={busy}>{{ all: 'Все', active: 'Активные', history: 'Завершённые' }[value]}</button>)}</div>
            {loading ? <Skeletons/> : visible.length ? <div className="order-list">{visible.map(card)}</div> : <EmptyState title={filter === 'history' ? 'История пока пуста' : 'Заказов пока нет'} action={customer ? <Button variant="secondary" onClick={newDelivery}>Заказать доставку</Button> : refresh}>{filter === 'history' ? 'Завершённые и отменённые доставки сохранятся здесь.' : customer ? 'Создайте первую доставку, чтобы передать посылку.' : 'Ваши принятые доставки появятся здесь.'}</EmptyState>}<SyncTime value={syncedAt} offline={!!syncError}/></>}

          {view === 'create' && customer && <>{repeated&&<Feedback title="Данные из прошлого заказа">Проверьте адреса и получателя. Прежние время, стоимость, срочность и открытка не перенесены.</Feedback>}<OrderForm draft={draft} onChange={setDraft} onReview={() => navigate('review')} onPoint={(kind) => editAddress(kind, 'create')} busy={busy}/></>}
          {view === 'point' && customer && <AddressPicker key={pointSession} kind={pointKind} address={pointOrigin==='business'?businessDraft.pickupAddress:draft[`${pointKind}Address`]} pickupAddress={draft.pickupAddress} point={point} onChange={setPoint} onAddress={setPointAddress} mode={pointMode} onModeChange={setPointMode}/>}
          {view === 'review' && customer && <OrderReview draft={draft} onEdit={() => navigate('create')} busy={busy} pricing={<>
            {pricing.enabled===true&&draft.timing==='window'&&<Feedback title="Расчёт для будущей даты пока недоступен" tone="warning">{futurePriceMessage}</Feedback>}
            {pricing.enabled===false?<PriceNote/>:<><p className="muted">Автомобиль</p>{pricing.enabled===true&&<section className="review-section"><h2>Условия посылки</h2><label className="courier-consent"><input type="checkbox" checked={draft.pilotParcelConfirmed} disabled={busy} onChange={event=>setDraft(current=>({...current,pilotParcelConfirmed:event.target.checked}))}/><span>{deliveryPilot.parcelStatement}</span></label><p className="muted payment-hint">Доставка до двери в зоне сервиса. Включено по 5 минут на получение и вручение. Автоматических доплат нет. <a href="/rules" target="_blank" rel="noopener noreferrer">Правила доставки</a></p></section>}{pricing.enabled!==true||draft.pilotParcelConfirmed?<QuoteSummary quote={pricing.quote} previousPrice={pricing.previousPrice} busy={pricing.busy} error={pricing.error} onRetry={pricing.retry} onExpired={pricing.expire}/>:<p className="muted">Подтвердите условия посылки, чтобы рассчитать стоимость.</p>}</>}
            <PaymentChoices payer={draft.payer} paymentMethod={draft.paymentMethod} disabled={busy} onChange={(field,value)=>setDraft(current=>({...current,[field]:value}))}/>
            {proofError?<Feedback title={proofError} tone="error" role="alert" action={<Button variant="ghost" onClick={()=>setProofRetry(n=>n+1)}>Проверить условия</Button>}/>:proofEnabled===null?<p role="status">Проверяем условия вручения…</p>:proofEnabled&&<section className="review-section"><h2>Подтверждение вручения</h2><p className="muted">Курьер приложит фото упаковки в месте передачи. Доступ в Qadam — до 30 суток.</p><label className="courier-consent"><input type="checkbox" checked={draft.codeRequired} disabled={busy} onChange={e=>setDraft(current=>({...current,codeRequired:e.target.checked}))}/><span>Код при вручении<small className="field-hint">Получатель назовёт его курьеру после получения. Код передаёте вы.</small></span></label></section>}
            <p className="muted">Подтверждённый номер из Telegram будет доступен курьеру после принятия заказа.{pricing.enabled&&!phone.profile.phoneVerified?' Перед созданием подтвердите свой номер для связи.':''}</p>
          </>}/>}
          {view==='phone'&&<PhoneProfilePanel profile={phone.profile} busy={phone.busy} notice={phone.notice}/>}
          {view==='business'&&customer&&<BusinessProfilePanel profile={business.profile} draft={businessDraft} onChange={setBusinessDraft} mode={businessMode} onMode={changeBusinessMode} phone={phone.profile} onPhone={()=>{setPhoneReturn('business');navigate('phone');}} onPoint={businessAddress} loading={business.loading} busy={business.busy} error={businessValidation||business.error} onRetry={business.refresh}/>}
          {view === 'detail' && (detail ? <OrderDetail key={detail.id} order={detail} user={user} onCancel={async () => { if (await confirmAction(`Отменить заказ ${orderNumber(detail)}? После отмены курьеры больше не смогут его принять.`)) await props.onMutate(`/api/orders/${detail.id}/status`, { status: 'CANCELLED' }, 'Заказ отменён и сохранён в истории.'); }} onReleased={()=>{props.onRefresh();navigate('orders');}} busy={busy}/> : <EmptyState title="Заказ больше недоступен" action={<Button variant="secondary" onClick={() => navigate('home')}>К списку заказов</Button>}>Возможно, его уже принял другой курьер. Обновите список и выберите другую доставку.</EmptyState>)}
          {view === 'profile' && <><h1 className="sr-only" tabIndex={-1}>Профиль</h1><div className="profile-card"><span className="avatar large">{initials(user.name)}</span><h2>{user.name}</h2><p className="muted">{customer ? 'Клиент' : 'Курьер'}{user.telegramId && ' · Telegram'}</p><p>{user.telegramId ? `Telegram ID: ${user.telegramId}` : user.email}</p></div><div className="profile-stats"><div><strong>{activeOrders.length}</strong><span>Активные</span></div><div><strong>{completed.length}</strong><span>Доставлены</span></div></div>
            {!customer&&props.telegram&&<CourierHomeScreen/>}
            {customer&&<Button variant="secondary" onClick={()=>{changeBusinessMode('view');business.refresh();navigate('business');}}>Мой магазин</Button>}
            {user.telegramId&&<Button variant="secondary" onClick={()=>{setPhoneReturn('profile');navigate('phone');}}>Мой телефон</Button>}
            {user.telegramId && <><Feedback title={customer ? 'Доставляй с Qadam' : 'Доступ курьера открыт'}>{customer ? 'Подай заявку. Администратор проверит её и откроет доступ к заказам.' : 'Принимай заказы и отмечай каждый шаг доставки.'}</Feedback><Button onClick={() => navigate('courierApplication')} disabled={busy}>{customer ? 'Стать курьером' : 'Моя заявка курьера'}</Button></>}
            {user.isAdmin && <><h2>Администрирование</h2><Button variant="secondary" onClick={() => navigate('adminOrders')} disabled={busy}>Все заказы</Button><Button variant="secondary" onClick={() => navigate('adminApplications')} disabled={busy}>Заявки курьеров</Button><Button variant="secondary" onClick={() => navigate('couriers')} disabled={busy}>Курьеры</Button></>}
            {!props.telegram && <Button variant="secondary" onClick={() => void props.onSignOut()} disabled={busy}>Выйти из аккаунта</Button>}</>}
        </div>
      </main>
      {hasFooter&&<footer data-telegram-actions key={view} className={`sticky-action ${view==='point'?'address-action':''}`}>
        {view==='business'?businessMode==='delete'?<><Button className="wide" disabled={business.busy} onClick={()=>void business.remove().then(ok=>{if(ok){setBusinessMode('view');setPickupSource('other');setDraft(current=>({...current,businessName:null}));}})}>{business.busy?'Удаляем…':'Удалить профиль'}</Button><Button variant="secondary" className="wide" disabled={business.busy} onClick={()=>changeBusinessMode('view')}>Оставить магазин</Button></>:businessMode==='edit'?<Button className="wide" disabled={business.busy||business.loading} onClick={()=>void saveBusiness()}>{business.busy?'Сохраняем…':'Сохранить магазин'}</Button>:<Button className="wide" disabled={business.loading||!!business.error} onClick={()=>business.profile?newDelivery():changeBusinessMode('edit')}>{business.profile?'Заказать из магазина':'Добавить магазин'}</Button>
        :view==='phone'?<Button className="wide" disabled={phone.busy} onClick={()=>phone.profile.phoneVerified?navigate(phoneReturn):void phone.request()}>{phone.busy?'Проверяем номер…':phone.profile.phoneVerified?phoneReturn==='business'?'Вернуться к магазину':phoneReturn==='profile'?'Вернуться в профиль':'Вернуться к заказу':'Поделиться номером'}</Button>
        :view==='point'?<Button className="wide" disabled={busy||pointAddress.trim().length<5||pointAddress.trim().length>200||((pointMode==='map'||pointOrigin==='business')&&!point)} onClick={confirmAddress}>{pointMode==='map'?'Подтвердить точку':'Выбрать адрес'}</Button>
        :view==='create'?<Button form="delivery-form" type="submit" className="wide" disabled={busy}>Проверить заказ</Button>
        :view==='review'?pricing.enabled===true&&draft.timing==='window'?<Button className="wide" disabled={busy} onClick={()=>{setDraft(current=>({...current,timing:'soon',pilotParcelConfirmed:false}));navigate('create');}}>Изменить время</Button>:<Button className="wide" onClick={()=>void confirmOrder()} disabled={busy||!pricing.ready||proofEnabled===null||!!proofError}>{busy?'Сохраняем…':needsPhone?'Подтвердить телефон':pricing.enabled?pricing.quote?`Создать заказ за ${formatMoney(pricing.quote.priceKzt)}`:'Рассчитываем стоимость…':'Подтвердить заказ'}</Button>
        :completedDetail?<>{customer&&detail&&<Button className="wide" disabled={busy} onClick={()=>repeat(detail)}>Повторить заказ</Button>}<Button className="wide" variant="secondary" onClick={history} disabled={busy}>В историю заказов</Button></>
        :actionable&&detail?<Button className="wide" disabled={busy||(detail.status==='SEARCHING_FOR_COURIER'&&(windowExpired(detail)||!courierPresence.canAccept))} onClick={()=>void(detail.status==='SEARCHING_FOR_COURIER'?accept(detail):advance(detail))}>{busy?'Сохраняем…':detail.status==='SEARCHING_FOR_COURIER'?windowExpired(detail)?'Интервал истёк':detail.pricing?`Принять · ${formatMoney(detail.pricing.courierPayoutKzt)}`:'Принять заказ':actionLabels[detail.status]}</Button>:null}
      </footer>}
      {showNav && <nav className="mobile-nav" aria-label="Мобильная навигация">{navItems.map((item) => <button type="button" key={item.view} className={view === item.view ? 'current' : ''} aria-current={view === item.view ? 'page' : undefined} disabled={busy} onClick={() => navigate(item.view)}><Icon type={item.icon}/><span>{item.label}</span></button>)}</nav>}
    </div>
  </div>;
}

function SyncTime({ value, offline }: { value: string | null; offline: boolean }) {
  return <p className={`sync-time ${offline ? 'offline' : ''}`}>{offline ? 'Нет обновлений · показаны последние полученные данные' : value ? `Обновлено в ${new Intl.DateTimeFormat('ru-KZ', { hour: '2-digit', minute: '2-digit', timeZone: serviceTimezone }).format(new Date(value))}` : 'Подключаемся…'}</p>;
}

function OrderDetail({ order, user, busy, onCancel,onReleased }: { order: Order; user: User; busy: boolean; onCancel: () => Promise<void>;onReleased:()=>void }) {
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
    {!customer&&order.status==='SEARCHING_FOR_COURIER'&&<CourierAvailability telegram={!!user.telegramId}/>}
    {order.courierId===user.id&&['ACCEPTED','PICKED_UP','IN_TRANSIT'].includes(order.status)&&<OrderLocationStream key={`location-stream:${order.id}:${order.assignmentVersion}`} order={order}/>}
    {customer && order.courierName && <div className="courier-contact"><span className="avatar">{initials(order.courierName)}</span><div><strong>{order.courierName}</strong><small>Ваш курьер</small></div></div>}
    <RouteCard pickup={order.pickupAddress} destination={order.destinationAddress}/>
    <OrderRequirements order={order}/>
    {!complete && <Recipient order={order}/>}
    <SavedOrderPrice order={order} courier={!customer}/>
    <OrderContacts order={order} customer={customer}/>
    {order.customerId===user.id&&<RecipientShare key={`recipient-share:${order.id}`} order={order}/>}
    {(order.customerId===user.id||order.courierId===user.id)&&(order.photoRequired||order.codeRequired||complete)&&<OrderTrustPanel key={`trust:${order.id}:${order.assignmentVersion}`} order={order} user={user}/>}
    {order.courierId===user.id&&order.status==='ACCEPTED'&&<CourierRelease order={order} onReleased={onReleased}/>}
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
  return <><section className="recipient-section"><h2>Получатель</h2>{order.recipientName && order.recipientPhone ? <><p>{order.recipientName}</p><PhoneLink className="recipient-phone" phone={order.recipientPhone}><Icon type="phone"/>{order.recipientPhone}</PhoneLink></> : <p className="muted">Контакты получателя откроются после принятия заказа</p>}</section>{order.notes && <section className="parcel-note"><h2>О доставке</h2><p className="pre-wrap">{order.notes}</p></section>}</>;
}
