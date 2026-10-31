'use client';

import { useRef, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { AddressRow, Button, Feedback, PriceNote, RouteCard } from './delivery-ui';
import type { MapPoint } from '../lib/types';
import { DeliveryMap } from './delivery-map';
import { deliveryPilot } from '../lib/delivery-pilot';
import { almatyInput,deliveryWindow,parcelLabels,scheduleError,repeatedParcel,type ParcelType } from '../lib/order-details';
import type { Order } from '../lib/types';

export const parcelTypes = ['Посылка','Документы','Цветы','Торт','Подарок','Другое'] as const;
const parcelCode:Record<typeof parcelTypes[number],ParcelType>={'Посылка':'PARCEL','Документы':'DOCUMENTS','Цветы':'FLOWERS','Торт':'CAKE','Подарок':'GIFT','Другое':'OTHER'};
export type OrderDraft = {
  pickupAddress: string; destinationAddress: string; recipientName: string; recipientPhone: string;
  parcelType: typeof parcelTypes[number]; parcelDescription: string; notes: string;
  pickupPoint: MapPoint | null; destinationPoint: MapPoint | null;
  payer: 'SENDER'|'RECIPIENT'; paymentMethod: 'KASPI_TRANSFER'|'CASH';
  pilotParcelConfirmed: boolean;
  timing:'soon'|'window';deliveryDate:string;deliveryFrom:string;deliveryTo:string;
  urgent:boolean;fragile:boolean;surprise:boolean;addCard:boolean;cardText:string;
  businessName:string|null;pickupDetails:string;
};
export const emptyDraft: OrderDraft = { pickupAddress: '', destinationAddress: '', recipientName: '', recipientPhone: '', parcelType: 'Посылка', parcelDescription: '', notes: '', pickupPoint: null, destinationPoint: null, payer:'SENDER',paymentMethod:'KASPI_TRANSFER',pilotParcelConfirmed:false,
  timing:'soon',deliveryDate:'',deliveryFrom:'',deliveryTo:'',urgent:false,fragile:false,surprise:false,addCard:false,cardText:'',businessName:null,pickupDetails:'' };

// Structured fields accompany the readable legacy notes; old orders remain intact.
export function orderPayload(draft: OrderDraft,quoteId?:string) {
  return {
    pickupAddress: draft.pickupAddress.trim(), destinationAddress: draft.destinationAddress.trim(),
    pickupPoint: draft.pickupPoint, destinationPoint: draft.destinationPoint,
    payer:draft.payer,paymentMethod:draft.paymentMethod,shareContact:true as const,...(quoteId?{quoteId,transport:'CAR' as const}:{}),
    ...(quoteId&&draft.pilotParcelConfirmed?{pilotTermsVersion:deliveryPilot.termsVersion}:{}),
    recipientName: draft.recipientName.trim(), recipientPhone: draft.recipientPhone.trim(),
    notes: [`Тип отправления: ${draft.parcelType}`, draft.parcelDescription.trim() && `О посылке: ${draft.parcelDescription.trim()}`, draft.notes.trim() && `Комментарий: ${draft.notes.trim()}`].filter(Boolean).join('\n'),
    parcelType:parcelCode[draft.parcelType],fragile:draft.fragile,surprise:draft.surprise,urgent:draft.urgent,
    cardText:draft.addCard?draft.cardText.trim()||null:null,businessName:draft.businessName,pickupDetails:draft.pickupDetails.trim()||null,
    deliverAfter:draft.timing==='window'?almatyInput(draft.deliveryDate,draft.deliveryFrom):null,
    deliverBefore:draft.timing==='window'?almatyInput(draft.deliveryDate,draft.deliveryTo):null,
  };
}

export function repeatDraft(order:Order):OrderDraft{
  const parcel=repeatedParcel(order);
  return {...emptyDraft,pickupAddress:order.pickupAddress,destinationAddress:order.destinationAddress,
    pickupPoint:order.pickupPoint,destinationPoint:order.destinationPoint,recipientName:order.recipientName??'',recipientPhone:order.recipientPhone??'',
    parcelType:parcelLabels[parcel.kind],parcelDescription:parcel.description,notes:parcel.notes,fragile:!!order.fragile,surprise:!!order.surprise,
    pickupDetails:order.pickupDetails??'',payer:order.payer??'SENDER',paymentMethod:order.paymentMethod??'KASPI_TRANSFER'};
}

export function ParcelChoice({ value, onChange, compact = false, disabled = false }: { value: OrderDraft['parcelType']; onChange: (value: OrderDraft['parcelType']) => void; compact?: boolean; disabled?: boolean }) {
  return <div className="choice-row" role="group" aria-label="Тип отправления">{parcelTypes.slice(0, compact ? 2 : parcelTypes.length).map((type) => <button type="button" className={`choice ${type === value ? 'selected' : ''}`} aria-pressed={type === value} onClick={() => onChange(type)} disabled={disabled} key={type}>{type}</button>)}</div>;
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
    setErrors((previous) => ({ ...previous, [key]: undefined,...(key.startsWith('delivery')?{deliveryDate:undefined}:{}) }));
  }
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problems: typeof errors = {};
    for (const key of ['pickupAddress', 'destinationAddress'] as const) if (draft[key].trim().length < 5) problems[key] = 'Укажите улицу и номер дома — минимум 5 символов.';
    if (draft.recipientName.trim().length < 2) problems.recipientName = 'Укажите имя получателя — минимум 2 символа.';
    if (!/^[+\d\s()\-]+$/.test(draft.recipientPhone) || draft.recipientPhone.replace(/\D/g, '').length < 7) problems.recipientPhone = 'Укажите номер полностью, например +7 700 123 45 67.';
    if(draft.timing==='window'){
      const data=orderPayload(draft);
      const error=!data.deliverAfter||!data.deliverBefore?'Укажите дату, начало и конец интервала.':scheduleError(data);
      if(error)problems.deliveryDate=error;
    }
    if(orderPayload(draft).notes.length>1000)problems.notes='Сократите описание и комментарий: вместе не больше 1000 символов.';
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
      <fieldset className="delivery-options"><legend>Когда доставить</legend>
        <div className="delivery-segments" role="group" aria-label="Время доставки">{(['soon','window'] as const).map(value=><button type="button" key={value} aria-pressed={draft.timing===value} onClick={()=>{onChange({...draft,timing:value,pilotParcelConfirmed:false});setErrors(current=>({...current,deliveryDate:undefined}));}}>{value==='soon'?'Как можно скорее':'Ко времени'}</button>)}</div>
        {draft.timing==='window'&&<div className="delivery-window-fields">
          <Field label="Дата доставки" name="deliveryDate" type="date" required value={draft.deliveryDate} error={errors.deliveryDate} onChange={e=>change('deliveryDate',e.target.value)}/>
          <div className="delivery-time-row"><Field label="С" name="deliveryFrom" type="time" required value={draft.deliveryFrom} onChange={e=>change('deliveryFrom',e.target.value)}/><Field label="До" name="deliveryTo" type="time" required value={draft.deliveryTo} onChange={e=>change('deliveryTo',e.target.value)}/></div>
          <p className="field-hint">Время Алматы. Интервал от 30 минут, в пределах 14 дней. Курьер увидит желаемое время перед принятием.</p>
        </div>}
        <label className="delivery-check"><input type="checkbox" checked={draft.urgent} onChange={e=>onChange({...draft,urgent:e.target.checked})}/><span>Важно доставить без задержки<small>Пожелание курьеру. Доплата автоматически не добавляется.</small></span></label>
      </fieldset>
      <h2>Что отправляем</h2>
      <ParcelChoice value={draft.parcelType} onChange={(value) => onChange({ ...draft, parcelType: value,pilotParcelConfirmed:false })}/>
      <Field label="О посылке" name="parcelDescription" placeholder="Например: книги, коробка до 5 кг" maxLength={200} value={draft.parcelDescription} onChange={(e) => change('parcelDescription', e.target.value)}/>
      <label className="delivery-check"><input type="checkbox" checked={draft.fragile} onChange={e=>onChange({...draft,fragile:e.target.checked})}/><span>Хрупкое<small>Перевозить бережно, не переворачивать.</small></span></label>
      <label className="delivery-check"><input type="checkbox" checked={draft.surprise} onChange={e=>onChange({...draft,surprise:e.target.checked})}/><span>Сюрприз для получателя<small>Курьеру: сначала свяжитесь с отправителем перед звонком получателю.</small></span></label>
      <label className="delivery-check"><input type="checkbox" checked={draft.addCard} onChange={e=>onChange({...draft,addCard:e.target.checked,cardText:e.target.checked?draft.cardText:''})}/><span>Добавить текст открытки</span></label>
      {draft.addCard&&<div className="field"><label htmlFor="draft-card">Текст открытки</label><textarea id="draft-card" value={draft.cardText} maxLength={300} rows={3} onChange={e=>onChange({...draft,cardText:e.target.value})}/><small className="field-hint">{draft.cardText.length} / 300. Передайте готовую открытку вместе с посылкой. Qadam не печатает открытки.</small></div>}
      {['Цветы','Торт'].includes(draft.parcelType)&&<p className="field-hint">Уточните с курьером подходящий транспорт и упаковку. Категория не означает наличие термобокса.</p>}
      <div className="field"><label htmlFor="draft-notes">Комментарий курьеру</label><textarea id="draft-notes" name="notes" maxLength={1000} rows={3} aria-invalid={!!errors.notes} aria-describedby="draft-notes-hint" placeholder="Как найти вход, домофон или другие детали" value={draft.notes} onChange={(e) => change('notes', e.target.value)}/><small id="draft-notes-hint" className={errors.notes?'field-error':'field-hint'}>{errors.notes||'Необязательно'}</small></div>
      <PriceNote/>
      <Feedback title="Стоимость по согласованию">Уточните условия доставки до передачи посылки. Онлайн-оплата не предусмотрена.</Feedback>
    </fieldset>
  </form>;
}

export function OrderReview({ draft, onEdit, busy,pricing }: { draft: OrderDraft; onEdit: () => void; busy: boolean;pricing?:React.ReactNode }) {
  return <div className="form-fields"><div className="screen-heading"><h1 tabIndex={-1}>Всё верно?</h1><p>Шаг 3 из 3 · проверьте перед отправкой</p></div>
    <RouteCard pickup={draft.pickupAddress} destination={draft.destinationAddress}/>
    {(draft.businessName||draft.pickupDetails)&&<section className="review-section"><h2>{draft.businessName||'Как найти отправителя'}</h2>{draft.pickupDetails&&<p className="pre-wrap">{draft.pickupDetails}</p>}</section>}
    <section className="review-section"><h2>Когда доставить</h2><p className="delivery-window">{draft.timing==='window'?deliveryWindow(orderPayload(draft)):'Как можно скорее'}</p>{draft.timing==='window'&&<p className="muted">Время Алматы · желаемый интервал. Заказ сразу увидят курьеры; назначение не гарантировано.</p>}{draft.urgent&&<p>Важно без задержки · автоматической доплаты нет.</p>}</section>
    {(draft.pickupPoint || draft.destinationPoint) && <DeliveryMap markers={[
      ...(draft.pickupPoint ? [{ ...draft.pickupPoint, kind: 'pickup' as const, label: `А · ${draft.pickupAddress}` }] : []),
      ...(draft.destinationPoint ? [{ ...draft.destinationPoint, kind: 'destination' as const, label: `Б · ${draft.destinationAddress}` }] : []),
    ]}/>}
    <section className="review-section"><h2>Получатель</h2><p>{draft.recipientName}<br/>{draft.recipientPhone}</p></section>
    <section className="review-section"><h2>{draft.parcelType}</h2>{draft.parcelDescription && <p>{draft.parcelDescription}</p>}{draft.fragile&&<p>Хрупкое — не переворачивать.</p>}{draft.surprise&&<p>Сюрприз — сначала связаться с отправителем.</p>}{draft.addCard&&draft.cardText&&<><h3>Текст открытки</h3><p className="pre-wrap">{draft.cardText}</p></>}</section>
    {draft.notes && <section className="review-section"><h2>Комментарий курьеру</h2><p className="pre-wrap">{draft.notes}</p></section>}
    {pricing??<><PriceNote/><Feedback title="Заказ появится у курьеров">После подтверждения сохраним доставку. Стоимость согласовывается отдельно.</Feedback></>}
    <Button variant="secondary" className="wide" onClick={onEdit} disabled={busy}>Изменить данные</Button>
  </div>;
}
