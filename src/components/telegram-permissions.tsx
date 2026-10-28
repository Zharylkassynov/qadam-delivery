'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/client-api';
import { telegramApp } from '../lib/telegram-client';
import { Button, Feedback } from './delivery-ui';

type Profile = { phone: string | null; allowsWrite: boolean };
export function useTelegramProfile(enabled: boolean, interval = 3000) {
  const [profile, setProfile] = useState<Profile>({ phone: null, allowsWrite: false });
  const [contactBusy, setContactBusy] = useState(false), [writeBusy, setWriteBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (!enabled) return () => { alive.current = false; };
    let fetching = false;
    const controller = new AbortController();
    const load = async () => {
      if (fetching || document.hidden) return;
      fetching = true;
      try { const data = await api<Profile>('/api/telegram-profile', undefined, controller.signal); if (alive.current) setProfile(data); }
      catch { /* Permissions are optional; a failed check must not block the application. */ }
      finally { fetching = false; }
    };
    void load(); const timer = setInterval(() => void load(), interval);
    return () => { alive.current = false; controller.abort(); clearInterval(timer); };
  }, [enabled, interval]);

  async function poll(check: (data: Profile) => boolean) {
    for (let i = 0; i < 10 && alive.current; i++) {
      const data = await api<Profile>('/api/telegram-profile');
      if (!alive.current) return null;
      setProfile(data);
      if (check(data)) return data;
      await new Promise(resolve => setTimeout(resolve, 600));
    }
    return null;
  }
  async function requestContact(onPhone: (phone: string) => void) {
    if (contactBusy) return;
    setContactBusy(true); setNotice('');
    try {
      const app = await telegramApp();
      if (!app?.requestContact) { setNotice('В этой версии Telegram можно ввести номер вручную.'); return; }
      const shared = await new Promise<boolean>(resolve => app.requestContact!(resolve));
      if (!alive.current) return;
      if (!shared) { setNotice('Номер не передан. Его можно ввести вручную.'); return; }
      // The SDK callback returns only a boolean. Trust the phone received by the bot,
      // where contact.user_id must match the authenticated Telegram sender.
      const data = await poll(data => Boolean(data.phone));
      if (alive.current) {
        if (data?.phone) { onPhone(data.phone); setNotice('Номер получен из Telegram.'); }
        else setNotice('Номер ещё не получен. Введи его вручную или повтори запрос.');
      }
    } catch { if (alive.current) setNotice('Не удалось получить номер. Введи его вручную.'); }
    finally { if (alive.current) setContactBusy(false); }
  }
  async function requestWriteAccess() {
    if (writeBusy) return;
    setWriteBusy(true); setNotice('');
    try {
      const app = await telegramApp();
      if (!app?.requestWriteAccess) { setNotice('Открой чат @qadam_delivery_bot и отправь /start, чтобы разрешить сообщения.'); return; }
      const allowed = await new Promise<boolean>(resolve => app.requestWriteAccess!(resolve));
      if (!alive.current) return;
      if (!allowed) { setNotice('Уведомления выключены. Решение можно посмотреть в приложении.'); return; }
      const data = await poll(data => data.allowsWrite);
      if (alive.current) setNotice(data ? 'Уведомления включены.' : 'Разрешение ещё проверяется. При необходимости отправь /start боту @qadam_delivery_bot.');
    } catch { if (alive.current) setNotice('Не удалось включить уведомления. Отправь /start боту @qadam_delivery_bot.'); }
    finally { if (alive.current) setWriteBusy(false); }
  }
  return { profile, contactBusy, writeBusy, notice, requestContact, requestWriteAccess };
}

export function TelegramNotifications({ enabled, allowed, busy, onRequest }: { enabled: boolean; allowed: boolean; busy: boolean; onRequest: () => void }) {
  if (!enabled) return null;
  return <Feedback title={allowed ? 'Уведомления включены' : 'Решение в Telegram'} tone={allowed ? 'success' : 'info'}>
    {allowed ? 'Бот сообщит о решении по заявке.' : <><p>Разреши боту отправлять сообщения. Подать заявку можно и без уведомлений.</p><Button type="button" variant="secondary" disabled={busy} onClick={onRequest}>{busy ? 'Проверяем разрешение…' : 'Разрешить уведомления'}</Button></>}
  </Feedback>;
}
