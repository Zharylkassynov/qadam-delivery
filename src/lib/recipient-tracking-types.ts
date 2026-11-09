import type {CourierLocation,Status} from './types';

export const recipientConsentVersion='2026-11-06-v1';
export const recipientConsentText='Разрешаю показывать моё имя и свежую геопозицию получателю по ссылке во время моих доставок. Позиция доступна после забора посылки и до завершения или отмены. Могу отозвать это разрешение в любой момент.';
export type RecipientDelivery={
  status:Status;businessName:string|null;deliverAfter:string|null;deliverBefore:string|null;
  courierName:string|null;location:CourierLocation|null;lastMeasuredAt:string|null;checkedAt:string;
  expiresAt:string;mapAvailable:boolean;
};
export type RecipientLink={url:string|null;expiresAt:string|null};
export function whatsAppLink(phone:string|null,url:string){
  const digits=phone?.replace(/\D/g,'')??'';
  if(!/^[1-9]\d{7,14}$/.test(digits))return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(`Вам отправлена доставка Qadam. Следить за статусом: ${url}`)}`;
}
