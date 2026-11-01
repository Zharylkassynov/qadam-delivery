// Used only by the dedicated local Playwright server, never imported by the application.
import {randomUUID} from 'node:crypto';
const db=new URL(process.env.DATABASE_URL??'');
const token='123456789:local_test_only_abcdefghijklmnopqrstuvwxyz',chatId='-1001234567890';
if(process.env.QADAM_PHOTO_TEST_PROVIDER!=='true'||!['localhost','127.0.0.1'].includes(db.hostname)||!db.pathname.endsWith('_test')||process.env.TELEGRAM_BOT_TOKEN!==token||process.env.TELEGRAM_STORAGE_CHAT_ID!==chatId)throw new Error('Photo provider fixture is restricted to a synthetic local test server');
const upstream=globalThis.fetch,photos=new Map();
globalThis.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.hostname!=='api.telegram.org')return upstream(input,init);
  const endpoint=`/bot${token}/`,fileEndpoint=`/file/bot${token}/photos/`;
  if(url.pathname.startsWith(fileEndpoint)){
    const file=photos.get(url.pathname.slice(fileEndpoint.length).replace(/\.jpg$/,''));
    return file?new Response(file,{headers:{'Content-Type':'image/jpeg'}}):Response.json({ok:false},{status:404});
  }
  if(!url.pathname.startsWith(endpoint))throw new Error('Real Telegram credentials are forbidden in local browser tests');
  const method=url.pathname.slice(endpoint.length);
  if(method==='getChat')return Response.json({ok:true,result:{id:chatId,type:'channel',message_auto_delete_time:2678400}});
  if(method==='sendPhoto'&&init?.body instanceof FormData){
    if(init.body.get('chat_id')!==chatId)throw new Error('Unexpected fixture destination');
    const id=`fixture-${randomUUID()}`,image=init.body.get('photo');photos.set(id,new Uint8Array(await image.arrayBuffer()));
    return Response.json({ok:true,result:{message_id:photos.size,chat:{id:chatId},photo:[{file_id:id}]}});
  }
  if(method==='getFile'){
    const body=JSON.parse(String(init?.body));if(!photos.has(body.file_id))return Response.json({ok:false},{status:404});
    return Response.json({ok:true,result:{file_path:`photos/${body.file_id}.jpg`}});
  }
  if(['sendMessage','sendPhoto','editMessageText','answerCallbackQuery'].includes(method))return Response.json({ok:true,result:{message_id:1}});
  throw new Error('Unexpected Telegram method in fixture');
};
