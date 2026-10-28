'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/client-api';
import type { CourierStatus } from '../lib/courier-status';
import { serviceTimezone } from '../lib/service-area';
import { useTelegramProfile } from './telegram-permissions';

export function CourierAvailability({ telegram }: { telegram: boolean }) {
  const [status, setStatus] = useState<CourierStatus | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const active = useRef(true), saving = useRef(false), version = useRef(0);
  const retry = useRef<boolean | null>(null);
  const permissions = useTelegramProfile(telegram, 15000);
  const load = useCallback(async () => {
    if (saving.current || document.hidden) return;
    if (active.current) setNow(Date.now());
    const current = version.current;
    try {
      const data = await api<{ status: CourierStatus }>('/api/courier/status');
      if (active.current && current === version.current) { setStatus(data.status); setNow(Date.now()); }
    } catch { if (active.current && current === version.current) setError('Не удалось проверить статус. Повторите запрос.'); }
  }, []);
  useEffect(() => {
    active.current = true; void load();
    const timer = setInterval(() => void load(), 15000);
    window.addEventListener('focus', load); document.addEventListener('visibilitychange', load);
    return () => { active.current = false; clearInterval(timer); window.removeEventListener('focus', load); document.removeEventListener('visibilitychange', load); };
  }, [load]);
  async function save(online: boolean) {
    if (saving.current) return;
    saving.current = true; version.current++; retry.current = online; setBusy(true); setError('');
    try {
      const data = await api<{ status: CourierStatus }>('/api/courier/status', { online });
      if (active.current) { setStatus(data.status); setNow(Date.now()); retry.current = null; }
    } catch { if (active.current) setError('Не удалось сохранить статус. Предыдущее состояние сохранено.'); }
    finally { saving.current = false; if (active.current) setBusy(false); }
  }
  const expired = Boolean(status?.expired || (status?.online && status.expiresAt && Date.parse(status.expiresAt) <= now));
  const online = Boolean(status?.online && !expired);
  const allowed = Boolean(status?.allowsWrite);
  const time = status?.expiresAt ? new Intl.DateTimeFormat('ru-KZ', { hour: '2-digit', minute: '2-digit', timeZone: serviceTimezone }).format(new Date(status.expiresAt)) : '';
  return <section className={`courier-shift ${online ? 'is-online' : ''}`} aria-label="Готовность к заказам" aria-busy={busy}>
    <div className="availability-row"><strong><span className="availability-dot"/>{busy ? 'Сохраняем…' : !status ? 'Проверяем статус…' : online ? 'На линии' : 'Не на линии'}</strong>
      <button type="button" className="availability-switch" role="switch" aria-label="Я на линии" aria-checked={online} disabled={!status || busy} onClick={() => void save(!online)}><span/></button></div>
    <p className="availability-hint">{online ? allowed ? `Новые заказы придут в Telegram. На линии до ${time}.` : 'Режим включён, но сообщения ещё не разрешены.' : expired ? 'Смена завершилась через 8 часов. Включите режим, если готовы продолжить.' : 'Включите, когда готовы принимать заказы. Режим действует 8 часов.'}</p>
    {online && !allowed && <div className="availability-permission"><p>Чтобы получать заказы в Telegram, разрешите боту отправлять сообщения.</p>{telegram ? <button type="button" className="text-button" disabled={permissions.writeBusy} onClick={async () => { await permissions.requestWriteAccess(); await load(); }}>{permissions.writeBusy ? 'Проверяем разрешение…' : 'Разрешить сообщения'}</button> : <p>Откройте Qadam через @qadam_delivery_bot.</p>}{permissions.notice && <p role="status">{permissions.notice}</p>}</div>}
    {error && <div className="availability-error" role="alert">{error}<br/><button type="button" className="text-button" disabled={busy} onClick={() => { if (retry.current !== null) void save(retry.current); else { setError(''); void load(); } }}>Повторить</button></div>}
  </section>;
}
