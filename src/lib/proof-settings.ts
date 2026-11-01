import {AppError} from './errors';
export const photoMaxBytes=1048576;
export const photoMaxSide=1600;
export function codeKey(){
  const key=process.env.DELIVERY_CODE_SECRET;
  if(!key||!/^[a-f0-9]{64}$/i.test(key))throw new AppError(503,'Подтверждение вручения временно недоступно. Свяжитесь с командой.');
  return Buffer.from(key,'hex');
}
export function storageChat(){
  const id=process.env.TELEGRAM_STORAGE_CHAT_ID;
  if(!id||!/^-[1-9]\d{5,18}$/.test(id))throw new AppError(503,'Сервис фото вручения ещё не подключён. Свяжитесь с командой.');return id;
}
export function proofEnabled(){
  if(process.env.DELIVERY_PROOF_ENABLED!=='true')return false;
  codeKey();storageChat();
  if(!/^\d+:[A-Za-z0-9_-]{30,}$/.test(process.env.TELEGRAM_BOT_TOKEN??''))throw new AppError(503,'Сервис подтверждения ещё не подключён.');
  return true;
}
