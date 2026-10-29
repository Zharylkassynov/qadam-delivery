'use client';
import { useEffect,useState } from 'react';
import type { Order,OrderQuote } from '../lib/types';
import { Button,Feedback } from './delivery-ui';
import { PhoneLink } from './phone-link';

export const formatMoney=(value:number)=>`${new Intl.NumberFormat('ru-KZ',{maximumFractionDigits:2}).format(value)} ₸`;
export function PaymentChoices({payer,paymentMethod,onChange,disabled}:{payer:'SENDER'|'RECIPIENT';paymentMethod:'CASH'|'KASPI_TRANSFER';onChange:(field:'payer'|'paymentMethod',value:string)=>void;disabled:boolean}){
  return <><fieldset className="payment-choices" disabled={disabled}><legend>Кто платит</legend><div className="choice-row">{(['SENDER','RECIPIENT']as const).map(value=><label className="payment-choice" key={value}><input type="radio" name="payer" value={value} checked={payer===value} onChange={()=>onChange('payer',value)}/>{value==='SENDER'?'Отправитель':'Получатель'}</label>)}</div></fieldset><fieldset className="payment-choices" disabled={disabled}><legend>Способ оплаты</legend>{(['KASPI_TRANSFER','CASH']as const).map(value=><label className="payment-choice" key={value}><input type="radio" name="paymentMethod" value={value} checked={paymentMethod===value} onChange={()=>onChange('paymentMethod',value)}/><span>{value==='CASH'?'Наличные':'Перевод Kaspi'}<small>Напрямую курьеру</small></span></label>)}</fieldset><p className="muted payment-hint">{payer==='RECIPIENT'?'Предупредите получателя о сумме и способе оплаты. ':''}Когда рассчитаться, согласуйте с курьером. Онлайн-списания нет.</p></>;
}
export function QuoteSummary({quote,previousPrice,busy,error,onRetry,onExpired}:{quote:OrderQuote|null;previousPrice?:number|null;busy:boolean;error:string;onRetry:()=>void;onExpired:()=>void}){
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[quote?.id]);
  const expires=quote?Date.parse(quote.expiresAt):0;
  const expired=!!quote&&expires<=now;
  useEffect(()=>{if(expired)onExpired();},[expired,onExpired]);
  if(busy)return <Feedback title="Считаем дорогу и стоимость…" role="status">Адреса и условия доставки сохранены.</Feedback>;
  if(error)return <Feedback title="Не удалось рассчитать стоимость" tone="warning" role="alert">{error}<Button variant="secondary" onClick={onRetry}>Повторить расчёт</Button></Feedback>;
  if(!quote)return <Feedback title="Нужна стоимость доставки">Укажите обе точки на карте и рассчитайте цену.<Button variant="secondary" onClick={onRetry}>Рассчитать стоимость</Button></Feedback>;
  const b=quote.breakdown,remaining=Math.max(0,Math.ceil((expires-now)/1000));
  return <section className="quote-price" aria-label="Расчёт стоимости">{!expired&&previousPrice!=null&&previousPrice!==quote.priceKzt&&<Feedback title="Стоимость изменилась" tone="warning">Новая цена — {formatMoney(quote.priceKzt)} вместо {formatMoney(previousPrice)}. Проверьте условия перед созданием заказа.</Feedback>}<div className="quote-price-row"><span>{expired?'Предыдущая цена':'Стоимость доставки'}</span><strong>{formatMoney(quote.priceKzt)}</strong></div>
    {expired?<Feedback title="Цена больше не действует" tone="warning">Заказ ещё не создан. Рассчитайте стоимость заново и подтвердите новые условия.<Button variant="secondary" onClick={onRetry}>Обновить цену</Button></Feedback>:<><p className="muted payment-hint">Цена фиксируется после создания заказа.</p><details className="price-breakdown"><summary>Как получилась цена</summary><dl>{[['Базовая часть',b.baseKzt],['Дорога',b.distanceKzt],['Время дороги',b.timeKzt],['До минимальной стоимости',b.minimumAdjustmentKzt],['Округление',b.roundingKzt],['Комиссия Qadam',0]].map(([label,value])=><div key={String(label)}><dt>{label}</dt><dd>{formatMoney(Number(value))}</dd></div>)}</dl></details><p className="muted payment-hint">Цена действует ещё {Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')}.</p><p className="muted payment-hint">Дорога А → Б: {(quote.distanceM/1000).toLocaleString('ru-KZ',{maximumFractionDigits:1})} км, около {Math.ceil(quote.durationS/60)} минут по модели дорожной ситуации. Без поиска курьера, подачи и передачи посылки.</p></>}
  </section>;
}
export function SavedOrderPrice({order,courier=false}:{order:Order;courier?:boolean}){
  if(!order.pricing)return <><div className="price-row"><span>Стоимость доставки</span><strong>По согласованию</strong></div>{order.payer&&order.paymentMethod&&<p className="muted payment-hint">{order.payer==='RECIPIENT'?'Платит получатель':'Платит отправитель'} · {order.paymentMethod==='CASH'?'наличными':'переводом Kaspi'}. Сумму и момент расчёта согласуйте с курьером.</p>}</>;
  return <section className="quote-price"><div className="quote-price-row"><span>{courier?'Вам за доставку':'Стоимость доставки'}</span><strong>{formatMoney(courier?order.pricing.courierPayoutKzt:order.pricing.priceKzt)}</strong></div><p className="muted payment-hint">Цена зафиксирована. Комиссия Qadam — 0 ₸.</p><p className="muted payment-hint">{order.payer==='RECIPIENT'?'Платит получатель':'Платит отправитель'} · {order.paymentMethod==='CASH'?'наличными':'переводом Kaspi'}.</p><p className="muted payment-hint">Оплата напрямую курьеру. Приложение не подтверждает получение денег.</p></section>;
}
export function OrderContacts({order,customer}:{order:Order;customer:boolean}){
  const contacts=customer?[['Ваш курьер',order.courierName,order.courierPhone]]:[['Отправитель',order.customerName,order.senderPhone]];
  return <>{contacts.map(([title,name,phone])=><section className="recipient-section" key={title}><h2>{title}</h2>{order.courierId&&phone?<><p>{name}</p><PhoneLink className="button secondary" phone={phone}>Позвонить: {phone}</PhoneLink></>:<p className="muted">{order.courierId?'Номер пока не подтверждён в Telegram.':'Контакт откроется после назначения курьера.'}</p>}</section>)}</>;
}
