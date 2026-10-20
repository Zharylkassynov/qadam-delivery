'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../lib/client-api';
import { courierTransports, transportLabels, type CourierApplication, type CourierTransport, type User } from '../lib/types';
import { serviceCity } from '../lib/service-area';
import { Button, EmptyState, Feedback, Icon, formatTime } from './delivery-ui';

const errorText = (e: unknown) => e instanceof Error ? e.message : 'Не удалось выполнить запрос. Повторите.';
function ApplicationScreen({ title, children, actions, onBack, busy }: { title: string; children: ReactNode; actions: ReactNode; onBack: () => void; busy: boolean }) {
  const main = useRef<HTMLElement>(null);
  useEffect(() => { main.current?.focus({ preventScroll: true }); }, [title]);
  return <div className="app-shell application-shell"><div className="workspace with-action">
    <header className="product-header"><span className="product-header-mark"><Icon type="box"/></span><span>Qadam Delivery</span><span/></header>
    <div className="app-bar"><button className="icon-button" aria-label="Назад в профиль" disabled={busy} onClick={onBack}><Icon type="back"/></button><p>{title}</p><span/></div>
    <main className="screen-body screen-application" ref={main} tabIndex={-1}><div className="screen-content">{children}</div></main>
    <footer className="sticky-action application-actions">{actions}</footer>
  </div></div>;
}

export function CourierOnboarding({ user, onBack, onOrders }: { user: User; onBack: () => void; onOrders: () => void }) {
  const [application, setApplication] = useState<CourierApplication | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [editing, setEditing] = useState(false);
  const [loadError, setLoadError] = useState(''), [ready, setReady] = useState(false);
  const version = useRef(0), mutating = useRef(false);
  const [phone, setPhone] = useState(''), [transport, setTransport] = useState<CourierTransport | ''>('FOOT'), [notes, setNotes] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let alive = true, fetching = false; const controller = new AbortController();
    const load = async () => {
      if (fetching || mutating.current || document.hidden) return; fetching = true; const current = version.current;
      try { const result = await api<{ application: CourierApplication | null }>('/api/courier-application', undefined, controller.signal);
        if (alive && current === version.current) { setApplication(result.application); setLoadError(''); setReady(true); } }
      catch (e) { if (alive && current === version.current) setLoadError(errorText(e)); }
      finally { fetching = false; if (alive) setLoading(false); }
    };
    void load(); const timer = setInterval(() => void load(), 3000);
    const focus = () => void load(); window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    return () => { alive = false; controller.abort(); clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [refresh]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (mutating.current) return; mutating.current = true; version.current++; setBusy(true); setError('');
    try { const data = await api<{ application: CourierApplication }>('/api/courier-application', { phone, transport, notes }); setApplication(data.application); setEditing(false); }
    catch (e) { setError(errorText(e)); }
    finally { mutating.current = false; setBusy(false); }
  }
  const granted = ready && !application && user.role === 'COURIER';
  const form = ready && !loading && !granted && (!application || editing);
  let action: ReactNode = <Button onClick={onBack} disabled={busy}>Вернуться в профиль</Button>;
  if (loading) action = <Button disabled>Загружаем…</Button>;
  else if (!ready && loadError) action = <Button onClick={() => { setLoading(true); setRefresh((n) => n + 1); }}>Повторить подключение</Button>;
  else if (form) action = <Button type="submit" form="courier-application-form" disabled={busy}>{busy ? 'Отправляем…' : 'Отправить заявку'}</Button>;
  else if (granted) action = <Button onClick={onOrders}>К доступным заказам</Button>;
  else if (application?.status === 'APPROVED') action = <Button onClick={onOrders}>К доступным заказам</Button>;
  else if (application?.status === 'REJECTED') action = <Button onClick={(event) => { event.preventDefault(); setPhone(application.phone); setTransport(courierTransports.find(value => value === application.transport) ?? ''); setNotes(application.notes); setError(''); setEditing(true); }}>Подать повторно</Button>;
  return <ApplicationScreen title="Стать курьером" actions={action} onBack={onBack} busy={busy}>
    {loading && <p role="status">Загружаем заявку…</p>}
    {!loading && granted && <><h1>Можно начинать</h1><Feedback title="Доступ курьера открыт" tone="success">Доступ назначен администратором. Повторная заявка не требуется.</Feedback></>}
    {(error || loadError) && <Feedback title={error || loadError} tone="error" role="alert" action={loadError && ready ? <Button variant="ghost" onClick={() => setRefresh((n) => n + 1)}>Повторить</Button> : undefined}/>}
    {form && <form id="courier-application-form" onSubmit={(e) => void submit(e)} className="form-fields"><fieldset className="form-fields" disabled={busy}>
      <div className="screen-heading"><h1>Доставляй с Qadam</h1><p>Оставь контакты. Доступ к заказам появится после одобрения.</p></div><p>Город: {serviceCity}</p>
      <div className="field"><label htmlFor="courier-phone">Телефон для связи</label><input id="courier-phone" type="tel" autoComplete="tel" inputMode="tel" required minLength={7} maxLength={30} placeholder="+7 700 000 00 00" value={phone} onChange={(e) => setPhone(e.target.value)}/><small className="field-hint">Укажи номер, по которому с тобой можно связаться.</small></div>
      <div className="field"><label htmlFor="courier-transport">Способ доставки</label><select id="courier-transport" required value={transport} onChange={(e) => setTransport(e.target.value as CourierTransport)}>{transport === '' && <option value="" disabled>Выберите способ доставки</option>}{courierTransports.map(value => <option value={value} key={value}>{transportLabels[value]}</option>)}</select></div>
      <div className="field"><label htmlFor="courier-notes">Комментарий</label><textarea id="courier-notes" rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Когда удобно доставлять, опыт или вопросы"/><small className="field-hint">Необязательно · до 500 символов.</small></div>
    </fieldset></form>}
    {!loading && application && !editing && <>
      <h1>{application.status === 'PENDING' ? 'Заявка отправлена' : application.status === 'APPROVED' ? 'Можно начинать' : 'Нужно уточнить данные'}</h1>
      <Feedback role="status" tone={application.status === 'PENDING' ? 'warning' : application.status === 'APPROVED' ? 'success' : 'error'} title={application.status === 'PENDING' ? 'На рассмотрении' : application.status === 'APPROVED' ? 'Заявка одобрена' : 'Заявка отклонена'}>
        {application.status === 'PENDING' ? 'Администратор проверит данные. Решение появится здесь.' : application.status === 'APPROVED' ? 'Тебе открыт доступ к заказам курьера.' : `Причина: ${application.decisionReason}`}
      </Feedback>
      <h2>{serviceCity} · {transportLabels[application.transport]}</h2><p>{application.phone}</p>{application.notes && <p className="muted pre-wrap">{application.notes}</p>}
      <p className="muted">{application.status === 'PENDING' ? 'Повторно отправлять заявку не нужно. Данные сохранятся после закрытия Mini App.' : application.status === 'REJECTED' ? 'Исправь данные и отправь новую заявку. Предыдущее решение сохранится в истории.' : 'Принимай заказы и отмечай каждый шаг доставки.'}</p>
    </>}
    {!user.telegramId && <Feedback tone="warning" title="Подать заявку можно из Telegram Mini App."/>}
  </ApplicationScreen>;
}

export function CourierApplicationAdmin({ user, onBack }: { user: User; onBack: () => void }) {
  const [applications, setApplications] = useState<CourierApplication[]>([]), [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [reason, setReason] = useState(''), [history, setHistory] = useState(false), [refresh, setRefresh] = useState(0);
  const [loadError, setLoadError] = useState('');
  const version = useRef(0), mutating = useRef(false);
  const application = applications.find((a) => a.id === selected);
  useEffect(() => {
    if (!user.isAdmin) return;
    let alive = true, fetching = false; const controller = new AbortController();
    const load = async () => { if (fetching || mutating.current || document.hidden) return; fetching = true; const current = version.current;
      try { const data = await api<{ applications: CourierApplication[] }>('/api/admin/courier-applications', undefined, controller.signal); if (alive && current === version.current) { setApplications(data.applications); setLoadError(''); } }
      catch (e) { if (alive && current === version.current) setLoadError(errorText(e)); }
      finally { fetching = false; if (alive) setLoading(false); }
    };
    void load(); const timer = setInterval(() => void load(), 3000);
    const focus = () => void load(); window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    return () => { alive = false; controller.abort(); clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [refresh, user.isAdmin]);
  async function review(decision: 'APPROVED' | 'REJECTED') {
    if (!application || mutating.current) return;
    if (decision === 'REJECTED' && reason.trim().length < 5) { setError('Укажите причину отклонения — минимум 5 символов.'); document.getElementById('courier-decision-reason')?.focus(); return; }
    mutating.current = true; version.current++; setBusy(true); setError(''); setNotice('');
    try { const result = await api<{ application: CourierApplication }>(`/api/admin/courier-applications/${application.id}`, { decision, reason }); setApplications((old) => old.map((a) => a.id === result.application.id ? result.application : a)); setNotice(decision === 'APPROVED' ? 'Заявка одобрена. Пользователю открыт доступ курьера.' : 'Заявка отклонена. Пользователь увидит причину.'); }
    catch (e) { setError(errorText(e)); }
    finally { mutating.current = false; setBusy(false); setRefresh((n) => n + 1); }
  }
  const visible = applications.filter((a) => history ? a.status !== 'PENDING' : a.status === 'PENDING');
  const actions = application?.status === 'PENDING' && user.isAdmin ? <><Button disabled={busy || !application.applicantActive} onClick={() => void review('APPROVED')}>{busy ? 'Сохраняем…' : 'Одобрить заявку'}</Button><Button variant="secondary" disabled={busy || !application.applicantActive} onClick={() => void review('REJECTED')}>Отклонить заявку</Button></> : <Button variant={application ? 'primary' : 'secondary'} disabled={busy} onClick={() => application ? setSelected(null) : setRefresh((n) => n + 1)}>{application ? 'К списку заявок' : 'Обновить список'}</Button>;
  return <ApplicationScreen title={application ? 'Рассмотрение заявки' : 'Заявки курьеров'} actions={actions} busy={busy} onBack={() => { if (selected) { setSelected(null); setError(''); setNotice(''); } else onBack(); }}>
    {!user.isAdmin ? <Feedback title="Этот раздел доступен только администратору." tone="error" role="alert"/> : <>
      {(error || loadError) && <Feedback title={error || loadError} tone="error" role="alert"/>}{notice && <Feedback title={notice} tone="success" role="status"/>}
      {loading && <p role="status">Загружаем заявки…</p>}
      {application ? <><h1>{application.name}</h1><p className="muted">Telegram ID: {application.telegramId}</p><h2>{serviceCity} · {transportLabels[application.transport]}</h2><a href={`tel:${application.phone.replace(/[^+\d]/g, '')}`}>{application.phone}</a><p className="muted pre-wrap">{application.notes}</p><p className="muted">Подана {formatTime(application.submittedAt)}</p>
        {!application.applicantActive && <Feedback title="Аккаунт заявителя отключён." tone="warning"/>}
        {application.status === 'PENDING' ? <><div className="field"><label htmlFor="courier-decision-reason">Причина отклонения</label><textarea id="courier-decision-reason" rows={3} maxLength={500} value={reason} disabled={busy} onChange={(e) => { setReason(e.target.value); if (e.target.value.trim().length >= 5) setError(''); }} aria-describedby="courier-reason-hint"/><small className="field-hint" id="courier-reason-hint">Обязательно только при отклонении.</small></div><Feedback title="Проверь данные перед решением">Одобрение откроет пользователю заказы курьера.</Feedback></> : <Feedback title={application.status === 'APPROVED' ? 'Заявка одобрена' : 'Заявка отклонена'} tone={application.status === 'APPROVED' ? 'success' : 'error'}>{application.decisionReason || 'Пользователю открыт доступ курьера.'}{application.reviewedAt && <p>{application.reviewer} · {formatTime(application.reviewedAt)}</p>}</Feedback>}
      </> : <><h1>Заявки курьеров</h1><div className="choice-row"><Button variant={history ? 'secondary' : 'primary'} onClick={() => setHistory(false)} aria-pressed={!history}>Новые</Button><Button variant={history ? 'primary' : 'secondary'} onClick={() => setHistory(true)} aria-pressed={history}>Рассмотренные</Button></div>
        {!loading && !visible.length && !error && <EmptyState title={history ? 'Пока нет решений' : 'Новых заявок пока нет'}>Заявки появятся здесь после отправки пользователями.</EmptyState>}
        {visible.map((a) => <article className="application-card" key={a.id}><h2>{a.name}</h2><p>{serviceCity} · {transportLabels[a.transport]}</p><p>{a.phone}</p><p className="muted">Telegram ID: {a.telegramId}</p><p className="muted">{a.status === 'PENDING' ? 'На рассмотрении' : a.status === 'APPROVED' ? 'Одобрена' : 'Отклонена'} · {formatTime(a.submittedAt)}</p><Button variant="secondary" onClick={() => { setSelected(a.id); setReason(''); setError(''); setNotice(''); }}>{a.status === 'PENDING' ? 'Рассмотреть заявку' : 'Решение по заявке'}</Button></article>)}
      </>}
    </>}
  </ApplicationScreen>;
}
