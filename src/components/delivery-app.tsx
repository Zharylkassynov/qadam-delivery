'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Order, User } from '../lib/types';
import { Brand, Button, Feedback, Icon } from './delivery-ui';
import { DeliveryWorkspace } from './delivery-workspace';
import type { orderPayload } from './order-form';
import { telegramApp } from '../lib/telegram-client';
import { serviceCity } from '../lib/service-area';
import { validSource } from '../lib/courier-options';
import { api, ApiError, setTelegramSessionToken } from '../lib/client-api';
import { orderReference } from '../lib/order-links';
import { CourierPresenceProvider } from './courier-presence';

const message = (error: unknown) => error instanceof Error ? error.message : 'Произошла ошибка. Попробуйте ещё раз.';

export function DeliveryApp() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState('');
  const [demo, setDemo] = useState(false);
  const [telegram, setTelegram] = useState(false);
  const [entry, setEntry] = useState<{ screen?: 'courier' | 'adminApplications' | 'adminOrders'; source?: string; order?: string }>({});
  const [linkedId, setLinkedId] = useState<string>();
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState('');
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const revision = useRef(0);
  const busyRef = useRef(false);
  const pendingCreate = useRef<{ payload: string; key: string; uncertain?:boolean } | null>(null);
  const lastMutationStatus=useRef<number|null>(null);
  const bootTask = useRef<Promise<void> | null>(null);

  const boot = useCallback(async () => {
    if (bootTask.current) return bootTask.current;
    bootTask.current = (async () => {
      setBootError(''); setBooting(true);
      try {
        const app = await telegramApp();
        setTelegram(Boolean(app));
        if (app) {
          const data = await api<{ user: User; sessionToken: string; source?: string; startScreen?: 'courier'; order?: string }>('/api/auth/telegram', { initData: app.initData });
          setTelegramSessionToken(data.sessionToken);
          const params = new URLSearchParams(window.location.search);
          setEntry({ screen: data.startScreen ?? (params.get('screen') === 'courier' ? 'courier' : params.get('screen') === 'adminApplications' && data.user.isAdmin ? 'adminApplications' : params.get('screen') === 'adminOrders' && data.user.isAdmin ? 'adminOrders' : undefined), source: data.source ?? validSource(params.get('src')), order: data.order ?? orderReference(params.get('order')) });
          setUser(data.user); setOrders([]); setLoading(true); setSelected(null); setError(''); setSyncError(''); setSyncedAt(null);
        } else {
          setTelegramSessionToken(undefined);
          const data = await api<{ user: User | null; demo: boolean }>('/api/session');
          const params = new URLSearchParams(window.location.search);
          setEntry({ order: orderReference(params.get('order')), screen: params.get('screen') === 'adminOrders' && data.user?.isAdmin ? 'adminOrders' : undefined });
          setUser(data.user); setDemo(data.demo);
        }
      } catch (error) { setBootError(message(error)); }
      finally { setBooting(false); bootTask.current = null; }
    })();
    return bootTask.current;
  }, []);
  useEffect(() => { void boot(); }, [boot]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    let fetching = false;
    const controller = new AbortController();
    async function load() {
      if (fetching || busyRef.current || document.hidden) return;
      fetching = true;
      const current = revision.current;
      try {
        const data = await api<{ orders: Order[]; user?: User }>('/api/orders', undefined, controller.signal);
        if (alive && current === revision.current) {
          setOrders(data.orders); setSyncError(''); setSyncedAt(new Date().toISOString());
          if (data.user && (data.user.role !== user!.role || data.user.isAdmin !== user!.isAdmin)) {
            setSelected(null); setUser(data.user);
          }
        }
      } catch (error) {
        if (alive && current === revision.current) {
          setSyncError(message(error));
          if (error instanceof ApiError && error.status === 401) { setUser(null); setOrders([]); }
        }
      } finally { fetching = false; if (alive) setLoading(false); }
    }
    void load();
    const timer = setInterval(() => { void load(); }, 15000);
    const onFocus = () => { void load(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => { alive = false; controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('focus', onFocus); };
  }, [user, refresh]);

  useEffect(() => {
    if (!user || !entry.order) return;
    let alive = true;
    const controller = new AbortController();
    void api<{ order: Order }>(`/api/orders/${encodeURIComponent(entry.order)}`, undefined, controller.signal).then(({ order }) => {
      if (!alive) return;
      if (user.isAdmin && order.customerId !== user.id && order.courierId !== user.id) setEntry(value => ({ ...value, screen: 'adminOrders' }));
      setDetailOrder(order); setSelected(order.id); setLinkedId(order.id);
    }).catch(e => { if (alive) setError(message(e)); });
    return () => { alive = false; controller.abort(); };
  }, [user, entry.order]);

  useEffect(() => {
    if (!user || !openDetailId) return;
    let alive = true, fetching = false;
    const controller = new AbortController();
    async function load() {
      if (fetching || busyRef.current || document.hidden) return;
      fetching = true; const current = revision.current;
      try {
        const { order } = await api<{ order: Order }>(`/api/orders/${openDetailId}`, undefined, controller.signal);
        if (alive && current === revision.current) { setDetailOrder(order); setSyncError(''); setSyncedAt(new Date().toISOString()); }
      } catch (e) {
        if (alive && current === revision.current) {
          setSyncError(message(e));
          if (e instanceof ApiError && [401,403,404].includes(e.status)) {
            setDetailOrder(null); setOrders(previous => previous.filter(o => o.id !== openDetailId));
            if (e.status === 401) { setUser(null); setOrders([]); }
          }
        }
      } finally { fetching = false; }
    }
    void load(); const timer = setInterval(() => void load(), 3000);
    window.addEventListener('focus', load); document.addEventListener('visibilitychange', load);
    return () => { alive = false; controller.abort(); clearInterval(timer); window.removeEventListener('focus', load); document.removeEventListener('visibilitychange', load); };
  }, [user, openDetailId, refresh]);

  async function signIn(email: string, password: string) {
    setTelegramSessionToken(undefined);
    const data = await api<{ user: User }>('/api/auth/login', { email, password });
    setOrders([]); setDetailOrder(null); setLinkedId(undefined); setLoading(true); setSelected(null); setError(''); setSyncedAt(null); setSyncError(''); setNotice(''); setUser(data.user);
  }

  async function signOut() {
    setBusy(true); busyRef.current = true; revision.current++;
    try { await api('/api/auth/logout', {}); setTelegramSessionToken(undefined); pendingCreate.current = null; setUser(null); setOrders([]); setNotice(''); setError(''); }
    catch (error) { setError(message(error)); }
    finally { setBusy(false); busyRef.current = false; }
  }

  async function mutate(path: string, body: unknown, success: string) {
    if (busyRef.current) return false;
    setBusy(true); busyRef.current = true; revision.current++; setError(''); setNotice('');lastMutationStatus.current=null;
    try {
      const { order } = await api<{ order: Order }>(path, body);
      setOrders((previous) => [order, ...previous.filter((item) => item.id !== order.id)]);
      setDetailOrder(order);
      setSelected(order.id); setNotice(success);
      return true;
    } catch (error) {
      lastMutationStatus.current=error instanceof ApiError?error.status:0;
      setError(message(error));
      if (error instanceof ApiError && error.status === 401) { setUser(null); setOrders([]); }
      return false;
    } finally { setBusy(false); busyRef.current = false; setRefresh((value) => value + 1); }
  }

  async function create(fields: ReturnType<typeof orderPayload>) {
    const payload = JSON.stringify(fields);
    // Resolve an ambiguous previous create before using a new quote/request key.
    // A lost response may have committed the old order at its confirmed price.
    if(pendingCreate.current?.uncertain&&pendingCreate.current.payload!==payload){
      const previous=pendingCreate.current;
      if(await mutate('/api/orders',{...JSON.parse(previous.payload),requestKey:previous.key},'Заказ создан. Он уже доступен курьерам.')){pendingCreate.current=null;return true;}
      if(lastMutationStatus.current!==409)return false;
    }
    if (pendingCreate.current?.payload !== payload) pendingCreate.current = { payload, key: crypto.randomUUID() };
    if (await mutate('/api/orders', { ...fields, requestKey: pendingCreate.current.key }, 'Заказ создан. Он уже доступен курьерам.')) {
      pendingCreate.current = null;
      return true;
    }
    pendingCreate.current.uncertain=lastMutationStatus.current===0||lastMutationStatus.current===503;
    return false;
  }

  if (booting) return <main className="boot-screen"><Brand/><p className="muted" role="status">Открываем Qadam…</p></main>;
  if (bootError) return <main className="boot-screen"><Brand/><p role="alert">{bootError}</p><button className="button primary" onClick={() => void boot()}>Повторить подключение</button></main>;
  if (!user && telegram) return <main className="boot-screen"><Brand/><p className="muted">Сессия завершена. Ваши заказы сохранены.</p><Button onClick={() => void boot()}>Войти через Telegram</Button></main>;
  if (!user) return demo ? <Login onLogin={signIn}/> : <TelegramEntry/>;

  return <CourierPresenceProvider key={user.id} user={user}><DeliveryWorkspace user={user} telegram={telegram} initialScreen={entry.screen} initialOrderId={linkedId} detailOrder={detailOrder} onDetailChange={setOpenDetailId} source={entry.source} orders={orders} loading={loading} busy={busy} error={error} notice={notice} syncError={syncError} syncedAt={syncedAt} selected={selected}
    onSelect={setSelected} onSignOut={signOut} onMutate={mutate} onCreate={create}
    onRefresh={() => setRefresh((value) => value + 1)} onClearMessages={() => { setError(''); setNotice(''); }}/></CourierPresenceProvider>;
}

function TelegramEntry() {
  return <main className="boot-screen telegram-entry"><div className="telegram-entry-content">
    <Brand/>
    <h1>Откройте Qadam<br/>в Telegram</h1>
    <p className="muted">Заказывайте доставку и принимайте заказы в приложении Qadam через Telegram.</p>
    <a className="button primary wide" href="https://t.me/qadam_delivery_bot">Открыть в Telegram</a>
    <p className="telegram-entry-hint muted">Вход выполняется автоматически.</p>
  </div></main>;
}

function Login({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try { await onLogin(email.trim().toLowerCase(), String(data.get('password'))); }
    catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  return <main className="login-page">
    <section className="login-story"><Brand/><div className="login-story-content"><h1>От отправителя<br/>до получателя.</h1><p>Доставка по {serviceCity}.<br/>Понятный путь на каждом шаге.</p><ol className="login-steps"><li><span>1</span>Создайте заказ</li><li><span>2</span>Курьер заберёт посылку</li><li><span>3</span>Получатель получит доставку</li></ol></div><small>Qadam Delivery · Учебный MVP, 2026</small></section>
    <section className="login-form-section"><div className="login-card"><div className="login-mobile-brand"><Brand/></div><span className="demo-tag">Демонстрационный вход</span><h1>С возвращением</h1><p className="muted">Войдите в свой тестовый аккаунт.</p>
      <form onSubmit={(event) => void submit(event)}><fieldset disabled={busy}>
        <div className="field"><label htmlFor="login-email">Логин</label><input id="login-email" type="email" name="email" autoComplete="username" placeholder="customer1@qadam.demo" required value={email} onChange={(event) => setEmail(event.target.value)}/></div>
        <div className="field"><label htmlFor="login-password">Пароль</label><input id="login-password" type="password" name="password" autoComplete="current-password" placeholder="Пароль тестового аккаунта" required maxLength={200}/></div>
        {error && <Feedback tone="error" title={error} role="alert"/>}
        <Button type="submit" className="wide" disabled={busy}>{busy ? 'Входим…' : 'Войти в аккаунт'}<Icon type="arrow"/></Button>
      </fieldset></form>
      <div className="demo-accounts"><h2>Аккаунты для проверки</h2><p>По три тестовых аккаунта клиента и курьера. Выберите логин, затем введите пароль из инструкции.</p><div className="choice-row"><button className="choice" type="button" disabled={busy} onClick={() => setEmail('customer1@qadam.demo')}>Клиент 1</button><button className="choice" type="button" disabled={busy} onClick={() => setEmail('courier1@qadam.demo')}>Курьер 1</button></div><small>customer1…3@qadam.demo<br/>courier1…3@qadam.demo</small></div>
      <p className="login-footnote">Для одновременной проверки клиента и курьера используйте разные профили браузера.</p>
    </div></section>
  </main>;
}
