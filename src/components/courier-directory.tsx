'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/client-api';
import type { CourierApplication, User } from '../lib/types';
import { transportLabels } from '../lib/types';
import { availabilityLabels, districtLabels } from '../lib/courier-options';
import { ApplicationScreen } from './courier-onboarding';
import { Button, EmptyState, Feedback, formatTime } from './delivery-ui';

export function CourierDirectory({ user, onBack }: { user: User; onBack: () => void }) {
  const [couriers, setCouriers] = useState<CourierApplication[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!user.isAdmin) return;
    let alive = true; const controller = new AbortController();
    setLoading(true);
    void api<{ couriers: CourierApplication[] }>('/api/admin/couriers', undefined, controller.signal)
      .then(data => { if (alive) { setCouriers(data.couriers); setError(''); } })
      .catch(error => { if (alive) setError(error instanceof Error ? error.message : 'Не удалось загрузить курьеров. Повтори запрос.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, [user.isAdmin, refresh]);
  return <ApplicationScreen title="Курьеры" courier busy={false} onBack={onBack} actions={<Button variant="secondary" disabled={loading} onClick={() => setRefresh(n => n + 1)}>Обновить список</Button>}>
    {!user.isAdmin ? <Feedback title="Этот раздел доступен только администратору." tone="error" role="alert"/> : <>
      <div className="screen-heading"><h1>Курьеры</h1><p>Одобренные заявки и контакты для связи.</p></div>
      {error && <Feedback title={error} tone="error" role="alert"/>}
      {loading && <p role="status">Загружаем курьеров…</p>}
      {!loading && !error && !couriers.length && <EmptyState title="Одобренных курьеров пока нет">Рассмотри новые заявки в профиле.</EmptyState>}
      <div className="courier-directory">{couriers.map(courier => <article className="courier-directory-row" key={courier.id}>
        <h2>{courier.name}</h2><span className="courier-access-label">Доступ открыт</span>
        <a href={`tel:${courier.phone.replace(/[^+\d]/g, '')}`}>{courier.phone}</a>
        <p>{transportLabels[courier.transport]}{courier.district ? ` · ${districtLabels[courier.district]}` : ''}</p>
        <p>{courier.availability.length ? courier.availability.map(value => availabilityLabels[value]).join(', ') : 'Время не указано'}</p>
        <small className="muted">Источник: {courier.source ?? 'не указан'}<br/>{courier.reviewedAt && `Одобрено ${formatTime(courier.reviewedAt)}`}</small>
      </article>)}</div>
    </>}
  </ApplicationScreen>;
}
