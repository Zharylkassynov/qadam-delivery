'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Order, User } from '../lib/types';
import { Brand, Button, Feedback, Icon } from './delivery-ui';
import { DeliveryWorkspace } from './delivery-workspace';
import type { orderPayload } from './order-form';
import { telegramApp } from '../lib/telegram-client';
import { serviceCity } from '../lib/service-area';
import { api, ApiError, setTelegramSessionToken } from '../lib/client-api';

const message = (error: unknown) => error instanceof Error ? error.message : 'Произошла ошибка. Попробуйте ещё раз.';

export function DeliveryApp() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState('');
  const [demo, setDemo] = useState(false);
  const [telegram, setTelegram] = useState(false);
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
  const pendingCreate = useRef<{ payload: string; key: string } | null>(null);
  const bootTask = useRef<Promise<void> | null>(null);

  const boot = useCallback(async () => {
    if (bootTask.current) return bootTask.current;
    bootTask.current = (async () => {
      setBootError(''); setBooting(true);
      try {
        const app = await telegramApp();
        setTelegram(Boolean(app));
        if (app) {
          const data = await api<{ user: User; sessionToken: string }>('/api/auth/telegram', { initData: app.initData });
          setTelegramSessionToken(data.sessionToken);
          setUser(data.user); setOrders([]); setLoading(true); setSelected(null); setError(''); setSyncError(''); setSyncedAt(null);
        } else {
          setTelegramSessionToken(undefined);
          const data = await api<{ user: User | null; demo: boolean }>('/api/session');
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
    const timer = setInterval(() => { void load(); }, 3000);
    const onFocus = () => { void load(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => { alive = false; controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('focus', onFocus); };
  }, [user, refresh]);

  async function signIn(email: string, password: string) {
    setTelegramSessionToken(undefined);
    const data = await api<{ user: User }>('/api/auth/login', { email, password });
    setOrders([]); setLoading(true); setSelected(null); setError(''); setSyncedAt(null); setSyncError(''); setNotice(''); setUser(data.user);
  }

  async function signOut() {
    setBusy(true); busyRef.current = true; revision.current++;
    try { await api('/api/auth/logout', {}); setTelegramSessionToken(undefined); pendingCreate.current = null; setUser(null); setOrders([]); setNotice(''); setError(''); }
    catch (error) { setError(message(error)); }
    finally { setBusy(false); busyRef.current = false; }
  }

  async function mutate(path: string, body: unknown, success: string) {
    if (busyRef.current) return false;
    setBusy(true); busyRef.current = true; revision.current++; setError(''); setNotice('');
    try {
      const { order } = await api<{ order: Order }>(path, body);
      setOrders((previous) => [order, ...previous.filter((item) => item.id !== order.id)]);
      setSelected(order.id); setNotice(success);
      return true;
    } catch (error) {
      setError(message(error));
      if (error instanceof ApiError && error.status === 401) { setUser(null); setOrders([]); }
      return false;
    } finally { setBusy(false); busyRef.current = false; setRefresh((value) => value + 1); }
  }

  async function create(fields: ReturnType<typeof orderPayload>) {
    const payload = JSON.stringify(fields);
    if (pendingCreate.current?.payload !== payload) pendingCreate.current = { payload, key: crypto.randomUUID() };
    if (await mutate('/api/orders', { ...fields, requestKey: pendingCreate.current.key }, 'Заказ создан. Он уже доступен курьерам.')) {
      pendingCreate.current = null;
      return true;
    }
    return false;
  }

  if (booting) return <main className="boot-screen"><Brand/><p className="muted" role="status">Открываем Qadam…</p></main>;
  if (bootError) return <main className="boot-screen"><Brand/><p role="alert">{bootError}</p><button className="button primary" onClick={() => void boot()}>Повторить подключение</button></main>;
  if (!user && telegram) return <main className="boot-screen"><Brand/><p className="muted">Сессия завершена. Ваши заказы сохранены.</p><Button onClick={() => void boot()}>Войти через Telegram</Button></main>;
  if (!user) return <Login demo={demo} onLogin={signIn}/>;

  return <DeliveryWorkspace user={user} orders={orders} loading={loading} busy={busy} error={error} notice={notice} syncError={syncError} syncedAt={syncedAt} selected={selected}
    onSelect={setSelected} onSignOut={signOut} onMutate={mutate} onCreate={create}
    onRefresh={() => setRefresh((value) => value + 1)} onClearMessages={() => { setError(''); setNotice(''); }}/>;
}

function Login({ demo, onLogin }: { demo: boolean; onLogin: (email: string, password: string) => Promise<void> }) {
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
      {!demo && <Feedback tone="error" title="Демонстрационный вход отключён на сервере."/>}
      <form onSubmit={(event) => void submit(event)}><fieldset disabled={busy || !demo}>
        <div className="field"><label htmlFor="login-email">Логин</label><input id="login-email" type="email" name="email" autoComplete="username" placeholder="customer1@qadam.demo" required value={email} onChange={(event) => setEmail(event.target.value)}/></div>
        <div className="field"><label htmlFor="login-password">Пароль</label><input id="login-password" type="password" name="password" autoComplete="current-password" placeholder="Пароль тестового аккаунта" required maxLength={200}/></div>
        {error && <Feedback tone="error" title={error} role="alert"/>}
        <Button type="submit" className="wide" disabled={busy || !demo}>{busy ? 'Входим…' : 'Войти в аккаунт'}<Icon type="arrow"/></Button>
      </fieldset></form>
      {demo && <div className="demo-accounts"><h2>Аккаунты для проверки</h2><p>По три тестовых аккаунта клиента и курьера. Выберите логин, затем введите пароль из инструкции.</p><div className="choice-row"><button className="choice" type="button" disabled={busy} onClick={() => setEmail('customer1@qadam.demo')}>Клиент 1</button><button className="choice" type="button" disabled={busy} onClick={() => setEmail('courier1@qadam.demo')}>Курьер 1</button></div><small>customer1…3@qadam.demo<br/>courier1…3@qadam.demo</small></div>}
      <p className="login-footnote">Для одновременной проверки клиента и курьера используйте разные профили браузера.</p>
    </div></section>
  </main>;
}
