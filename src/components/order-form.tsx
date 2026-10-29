'use client';

import { useRef, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { AddressRow, Button, Feedback, PriceNote, RouteCard } from './delivery-ui';
import type { MapPoint } from '../lib/types';
import { DeliveryMap } from './delivery-map';
import { deliveryPilot } from '../lib/delivery-pilot';

export const parcelTypes = ['Посылка', 'Документы', 'Товары'] as const;
export type OrderDraft = {
  pickupAddress: string; destinationAddress: string; recipientName: string; recipientPhone: string;
  parcelType: typeof parcelTypes[number]; parcelDescription: string; notes: string;
  pickupPoint: MapPoint | null; destinationPoint: MapPoint | null;
  payer: 'SENDER'|'RECIPIENT'; paymentMethod: 'KASPI_TRANSFER'|'CASH';
  pilotParcelConfirmed: boolean;
};
export const emptyDraft: OrderDraft = { pickupAddress: '', destinationAddress: '', recipientName: '', recipientPhone: '', parcelType: 'Посылка', parcelDescription: '', notes: '', pickupPoint: null, destinationPoint: null, payer:'SENDER',paymentMethod:'KASPI_TRANSFER',pilotParcelConfirmed:false };

// Keep the existing API/database contract: parcel information is persisted in notes.
export function orderPayload(draft: OrderDraft,quoteId?:string) {
  return {
    pickupAddress: draft.pickupAddress.trim(), destinationAddress: draft.destinationAddress.trim(),
    pickupPoint: draft.pickupPoint, destinationPoint: draft.destinationPoint,
    payer:draft.payer,paymentMethod:draft.paymentMethod,shareContact:true as const,...(quoteId?{quoteId,transport:'CAR' as const}:{}),
    ...(quoteId&&draft.pilotParcelConfirmed?{pilotTermsVersion:deliveryPilot.termsVersion}:{}),
    recipientName: draft.recipientName.trim(), recipientPhone: draft.recipientPhone.trim(),
    notes: [`Тип отправления: ${draft.parcelType}`, draft.parcelDescription.trim() && `О посылке: ${draft.parcelDescription.trim()}`, draft.notes.trim() && `Комментарий: ${draft.notes.trim()}`].filter(Boolean).join('\n'),
  };
}

export function ParcelChoice({ value, onChange, compact = false, disabled = false }: { value: OrderDraft['parcelType']; onChange: (value: OrderDraft['parcelType']) => void; compact?: boolean; disabled?: boolean }) {
  return <div className="choice-row" role="group" aria-label="Тип отправления">{parcelTypes.slice(0, compact ? 2 : 3).map((type) => <button type="button" className={`choice ${type === value ? 'selected' : ''}`} aria-pressed={type === value} onClick={() => onChange(type)} disabled={disabled} key={type}>{type}</button>)}</div>;
}

function Field({ label, hint, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const id = `draft-${props.name}`;
  return <div className="field"><label htmlFor={id}>{label}</label><input id={id} aria-invalid={!!error} aria-describedby={error || hint ? `${id}-hint` : undefined} {...props}/>{(error || hint) && <small className={error ? 'field-error' : 'field-hint'} id={`${id}-hint`}>{error || hint}</small>}</div>;
}

export function OrderForm({ draft, onChange, onReview, onPoint, busy }: { draft: OrderDraft; onChange: (draft: OrderDraft) => void; onReview: () => void; onPoint: (kind: 'pickup' | 'destination') => void; busy: boolean }) {
  const [errors, setErrors] = useState<Partial<Record<keyof OrderDraft, string>>>({});
  const formRef = useRef<HTMLFormElement>(null);
  function change(key: keyof OrderDraft, value: string) {
    onChange({ ...draft, [key]: value, ...(key === 'parcelDescription' ? {pilotParcelConfirmed:false} : {}), ...(key === 'pickupAddress' ? { pickupPoint: null } : key === 'destinationAddress' ? { destinationPoint: null } : {}) });
    setErrors((previous) => ({ ...previous, [key]: undefined }));
  }
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problems: typeof errors = {};
    for (const key of ['pickupAddress', 'destinationAddress'] as const) if (draft[key].trim().length < 5) problems[key] = 'Укажите улицу и номер дома — минимум 5 символов.';
    if (draft.recipientName.trim().length < 2) problems.recipientName = 'Укажите имя получателя — минимум 2 символа.';
    if (!/^[+\d\s()\-]+$/.test(draft.recipientPhone) || draft.recipientPhone.replace(/\D/g, '').length < 7) problems.recipientPhone = 'Укажите номер полностью, например +7 700 123 45 67.';
    setErrors(problems);
    if (Object.keys(problems).length) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    onReview();
  }
  return <form id="delivery-form" ref={formRef} onSubmit={review} noValidate>
    <fieldset className="form-fields" disabled={busy}>
      <div className="screen-heading"><h1 tabIndex={-1}>Получатель и посылка</h1><p>Шаг 2 из 3 · детали доставки</p></div>
      <div className="recipient-route" aria-label="Адреса доставки">{(['pickup', 'destination'] as const).map((kind) => <div key={kind}><button type="button" className="address-edit" aria-label={kind === 'pickup' ? 'Изменить адрес отправления' : 'Изменить адрес доставки'} aria-invalid={!!errors[`${kind}Address`]} onClick={() => onPoint(kind)}><AddressRow kind={kind} address={draft[`${kind}Address`] || 'Укажите адрес'}/></button>{errors[`${kind}Address`] && <small className="field-error">{errors[`${kind}Address`]}</small>}</div>)}</div>
      <div className="divider"/>
      <p className="form-required-note">Имя и телефон обязательны.</p>
      <Field label="Имя получателя" name="recipientName" autoComplete="name" placeholder="Кому передать посылку" required minLength={2} maxLength={100} value={draft.recipientName} error={errors.recipientName} onChange={(e) => change('recipientName', e.target.value)}/>
      <Field label="Телефон получателя" name="recipientPhone" type="tel" autoComplete="tel" inputMode="tel" placeholder="+7 700 123 45 67" required minLength={7} maxLength={30} value={draft.recipientPhone} error={errors.recipientPhone} onChange={(e) => change('recipientPhone', e.target.value)} hint="Курьер позвонит, чтобы передать посылку."/>
      <h2>Что отправляем</h2>
      <ParcelChoice value={draft.parcelType} onChange={(value) => onChange({ ...draft, parcelType: value,pilotParcelConfirmed:false })}/>
      <Field label="О посылке" name="parcelDescription" placeholder="Например: книги, коробка до 5 кг" maxLength={200} value={draft.parcelDescription} onChange={(e) => change('parcelDescription', e.target.value)}/>
      <div className="field"><label htmlFor="draft-notes">Комментарий курьеру</label><textarea id="draft-notes" name="notes" maxLength={700} rows={3} placeholder="Как найти вход, домофон или другие детали" value={draft.notes} onChange={(e) => change('notes', e.target.value)}/><small className="field-hint">Необязательно</small></div>
      <PriceNote/>
      <Feedback title="Стоимость по согласованию">Уточните условия доставки до передачи посылки. Онлайн-оплата не предусмотрена.</Feedback>
    </fieldset>
  </form>;
}

export function OrderReview({ draft, onEdit, busy,pricing }: { draft: OrderDraft; onEdit: () => void; busy: boolean;pricing?:React.ReactNode }) {
  return <div className="form-fields"><div className="screen-heading"><h1 tabIndex={-1}>Всё верно?</h1><p>Шаг 3 из 3 · проверьте перед отправкой</p></div>
    <RouteCard pickup={draft.pickupAddress} destination={draft.destinationAddress}/>
    {(draft.pickupPoint || draft.destinationPoint) && <DeliveryMap markers={[
      ...(draft.pickupPoint ? [{ ...draft.pickupPoint, kind: 'pickup' as const, label: `А · ${draft.pickupAddress}` }] : []),
      ...(draft.destinationPoint ? [{ ...draft.destinationPoint, kind: 'destination' as const, label: `Б · ${draft.destinationAddress}` }] : []),
    ]}/>}
    <section className="review-section"><h2>Получатель</h2><p>{draft.recipientName}<br/>{draft.recipientPhone}</p></section>
    <section className="review-section"><h2>{draft.parcelType}</h2>{draft.parcelDescription && <p>{draft.parcelDescription}</p>}</section>
    {draft.notes && <section className="review-section"><h2>Комментарий курьеру</h2><p className="pre-wrap">{draft.notes}</p></section>}
    {pricing??<><PriceNote/><Feedback title="Заказ появится у курьеров">После подтверждения сохраним доставку. Стоимость согласовывается отдельно.</Feedback></>}
    <Button variant="secondary" className="wide" onClick={onEdit} disabled={busy}>Изменить данные</Button>
  </div>;
}
