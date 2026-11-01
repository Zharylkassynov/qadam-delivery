// The owner runs this command. It only checks Telegram; it never changes the webhook or sends a message.
const link=process.argv[2];
const match=/^https:\/\/t\.me\/c\/([1-9]\d{5,13})\/[1-9]\d*(?:\?.*)?$/.exec(link??'');
if(!match)throw new Error('Pass a message link: https://t.me/c/<channel>/<message>');
const chatId=`-100${match[1]}`;
process.loadEnvFile('.env.telegram');
const token=process.env.TELEGRAM_BOT_TOKEN;
if(!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token??''))throw new Error('Configure TELEGRAM_BOT_TOKEN in .env.telegram');
async function call(method,body={}){
  try{const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'error'});
    const data=await response.json();if(!response.ok||data?.ok!==true)throw new Error();return data.result;
  }catch{throw new Error(`Telegram ${method} unavailable; check the bot and channel permissions (details hidden)`);}
}
try{
  const me=await call('getMe'),chat=await call('getChat',{chat_id:chatId}),member=await call('getChatMember',{chat_id:chatId,user_id:me.id});
  const ready=chat.type==='channel'&&!chat.username&&String(chat.id)===chatId&&[2592000,2678400].includes(chat.message_auto_delete_time)&&member.status==='administrator'&&member.can_post_messages===true;
  console.log(JSON.stringify({ready,privateChannel:chat.type==='channel'&&!chat.username,autoDeleteDays:(chat.message_auto_delete_time??0)/86400,botCanPost:member.status==='administrator'&&member.can_post_messages===true}));
  if(!ready){console.error('Use a private channel, add the bot as administrator with posting rights, and enable auto-delete after one month (30 or 31 days).');process.exitCode=1;}
}catch(error){console.error(error instanceof Error?error.message.replaceAll(token,'[redacted]'):'Storage check failed');process.exitCode=1;}
