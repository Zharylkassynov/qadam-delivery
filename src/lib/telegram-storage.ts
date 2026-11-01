import {AppError} from './errors';
import {storageChat} from './proof-settings';

export type StoredPhoto={fileId:string;messageId:number;chatId:string};
export type PhotoStorage={upload:(bytes:Buffer,number:string)=>Promise<StoredPhoto>;download:(fileId:string)=>Promise<Buffer>};
const unavailable=()=>new AppError(503,'Фото сейчас недоступно. Повторите попытку или свяжитесь с командой.');
function botToken(){const token=process.env.TELEGRAM_BOT_TOKEN;if(!token||!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token))throw unavailable();return token;}
async function responseJson(response:Response){
  if(!response.ok)throw unavailable();
  const data=await response.json().catch(()=>null);if(data?.ok!==true)throw unavailable();return data.result;
}
async function request(method:string,body:Record<string,unknown>){
  return responseJson(await fetch(`https://api.telegram.org/bot${botToken()}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000),cache:'no-store'}));
}
export const telegramPhotoStorage:PhotoStorage={
  async upload(bytes,number){
    try{
      const chatId=storageChat();
      const chat=await request('getChat',{chat_id:chatId});
      if(chat.type!=='channel'||chat.username||String(chat.id)!==chatId||![2592000,2678400].includes(chat.message_auto_delete_time))throw unavailable();
      const form=new FormData();form.set('chat_id',chatId);form.set('photo',new Blob([Uint8Array.from(bytes)],{type:'image/jpeg'}),'delivery.jpg');
      form.set('caption',`Фото вручения QD-${number.padStart(4,'0')}`);form.set('protect_content','true');
      const result=await responseJson(await fetch(`https://api.telegram.org/bot${botToken()}/sendPhoto`,{method:'POST',body:form,redirect:'error',signal:AbortSignal.timeout(20000),cache:'no-store'}));
      const file=result?.photo?.at(-1)?.file_id;
      if(typeof file!=='string'||file.length>512||!Number.isSafeInteger(result.message_id)||result.message_id<=0||String(result.chat?.id)!==chatId)throw unavailable();
      return{fileId:file,messageId:result.message_id,chatId};
    }catch{throw unavailable();}
  },
  async download(fileId){
    try{
      const result=await request('getFile',{file_id:fileId});
      if(typeof result?.file_path!=='string'||!/^photos\/[A-Za-z0-9_./-]{1,240}$/.test(result.file_path)||result.file_path.includes('..'))throw unavailable();
      const response=await fetch(`https://api.telegram.org/file/bot${botToken()}/${result.file_path}`,{redirect:'error',signal:AbortSignal.timeout(10000),cache:'no-store'});
      if(!response.ok||!response.body)throw unavailable();
      const chunks:Uint8Array[]=[];let size=0;const reader=response.body.getReader();
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2097152){await reader.cancel();throw unavailable();}chunks.push(value);}
      return Buffer.concat(chunks);
    }catch{throw unavailable();}
  },
};
