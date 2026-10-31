import { serviceTimezone } from './service-area';

export const parcelLabels = { PARCEL:'Посылка',FLOWERS:'Цветы',CAKE:'Торт',GIFT:'Подарок',DOCUMENTS:'Документы',OTHER:'Другое' } as const;
export type ParcelType = keyof typeof parcelLabels;
export const parcelKinds = ['PARCEL','FLOWERS','CAKE','GIFT','DOCUMENTS','OTHER'] as const;

// Historical orders stored the parcel label in notes. Only a new draft is
// interpreted here; the original order and its notes are never rewritten.
export function repeatedParcel(order:{parcelType?:ParcelType|null;notes:string}){
  const lines=order.notes.split('\n');let kind=order.parcelType??'PARCEL';
  if(lines[0]?.startsWith('Тип отправления: ')){
    const label=lines[0].slice('Тип отправления: '.length);
    const known=parcelKinds.find(value=>parcelLabels[value]===label);
    if(!order.parcelType)kind=known??'OTHER';
    if(known)lines.shift();
    // Preserve historical "Товары" and unknown descriptions for the customer's review.
  }
  const description=lines[0]?.startsWith('О посылке: ')?lines.shift()!.slice('О посылке: '.length):'';
  const notes=lines.join('\n').replace(/^Комментарий: /,'');
  return {kind,description,notes};
}
export type DeliveryDetails = {
  parcelType?:ParcelType|null;fragile?:boolean;surprise?:boolean;urgent?:boolean;
  cardText?:string|null;businessName?:string|null;pickupDetails?:string|null;
  deliverAfter?:string|null;deliverBefore?:string|null;
};
export function scheduleError(data:DeliveryDetails,now=Date.now()):string|null {
  if(!data.deliverAfter&&!data.deliverBefore)return null;
  if(!data.deliverAfter||!data.deliverBefore)return 'Укажите начало и конец интервала доставки.';
  const from=new Date(data.deliverAfter).getTime(),to=new Date(data.deliverBefore).getTime();
  if(!Number.isFinite(from)||!Number.isFinite(to))return 'Проверьте дату и время доставки.';
  if(from<=now||to<=now)return 'Выберите будущие дату и время доставки.';
  if(to-from<30*60_000)return 'Выберите интервал не меньше 30 минут.';
  if(to>now+14*24*60*60_000)return 'Доставка ко времени доступна не дальше 14 дней.';
  const day=(timestamp:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:serviceTimezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(timestamp);
  if(day(from)!==day(to))return 'Начало и конец интервала должны быть в одном дне Алматы.';
  return null;
}
export function deliveryWindow(data:DeliveryDetails):string|null {
  if(!data.deliverAfter||!data.deliverBefore)return null;
  const day=new Intl.DateTimeFormat('ru-KZ',{timeZone:serviceTimezone,day:'numeric',month:'long'});
  const time=new Intl.DateTimeFormat('ru-KZ',{timeZone:serviceTimezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  return `${day.format(new Date(data.deliverAfter))}, ${time.format(new Date(data.deliverAfter))}–${time.format(new Date(data.deliverBefore))}`;
}
export function windowExpired(data:DeliveryDetails,now=Date.now()) { return !!data.deliverBefore&&new Date(data.deliverBefore).getTime()<=now; }
export const futurePriceMessage='Расчёт для будущей даты пока недоступен. Выберите «Как можно скорее» или свяжитесь с командой Qadam: @zharlkssnv.';

// Native date/time inputs contain Almaty wall time; convert explicitly, independently
// of the phone's timezone. Kazakhstan uses UTC+05:00 for this service area.
export function almatyInput(date:string,time:string):string|null {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))return null;
  const parsed=new Date(`${date}T${time}:00+05:00`);
  return Number.isFinite(parsed.getTime())&&new Date(parsed.getTime()+5*60*60_000).toISOString().slice(0,16)===`${date}T${time}`?parsed.toISOString():null;
}
