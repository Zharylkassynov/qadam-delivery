'use client';
import {useEffect,useState} from 'react';
import {api} from '../lib/client-api';
import {locationConsentVersion,type LocationStreamStatus} from '../lib/location-consent';
import type {Order} from '../lib/types';
import {Button,Feedback,formatTime} from './delivery-ui';
import {useTrustAction} from './order-trust';

export function OrderLocationStream({order}:{order:Order}){
  const [data,setData]=useState<LocationStreamStatus|null>(null),[error,setError]=useState(''),[open,setOpen]=useState(false),[consent,setConsent]=useState(false),[tick,setTick]=useState(0),[notice,setNotice]=useState('');
  const action=useTrustAction();
  useEffect(()=>{
    let alive=true,fetching=false;const controller=new AbortController();
    async function load(){
      if(document.hidden||fetching)return;fetching=true;
      try{const value=await api<LocationStreamStatus>(`/api/orders/${order.id}/location-stream`,undefined,controller.signal);if(alive){setData(value);setError('');}}
      catch(e){if(alive)setError(e instanceof Error?e.message:'Не удалось проверить трансляцию.');}
      finally{fetching=false;}
    }
    void load();const timer=setInterval(()=>void load(),3000);document.addEventListener('visibilitychange',load);
    return()=>{alive=false;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);};
  },[order.id,order.assignmentVersion,tick]);
  async function start(){
    const result=await action.run<LocationStreamStatus>(`/api/orders/${order.id}/location-stream`,{action:'START',expectedVersion:order.assignmentVersion??0,consentVersion:locationConsentVersion});
    if(result){setData(result);setOpen(false);setConsent(false);setNotice('Разрешение сохранено. Теперь откройте чат бота и включите трансляцию.');}
  }
  async function stop(){
    if(!data?.stream)return;
    const result=await action.run<LocationStreamStatus>(`/api/orders/${order.id}/location-stream`,{action:'STOP',expectedVersion:order.assignmentVersion??0,streamId:data.stream.id});
    if(result){setData(result);setOpen(false);setNotice('Использование трансляции в Qadam остановлено. Остановите её также в чате Telegram.');}
  }
  const stream=data?.stream,active=stream&&stream.state!=='STOPPED',stale=!!(stream?.updatedAt&&Date.now()-Date.parse(stream.updatedAt)>90000);
  const chat=<a className="button secondary wide" href="https://t.me/qadam_delivery_bot?start=location" target="_blank" rel="noopener noreferrer">Открыть чат бота</a>;
  const target=order.status==='ACCEPTED'?order.pickupPoint:order.destinationPoint;
  const navigation=target?`https://2gis.kz/almaty/directions/points/|${target.longitude},${target.latitude}`:null;
  if(data&&(!data.enabled||!data.allowed)&&!active)return null;
  return <section className="trust-section location-stream"><h2>Позиция во время навигации</h2>
    {error&&<Feedback title={error} tone="error" role="alert" action={<Button variant="ghost" onClick={()=>setTick(n=>n+1)}>Проверить трансляцию</Button>}/>}
    {!data&&!error&&<p role="status">Проверяем возможность подключения…</p>}
    {notice&&<p role="status">{notice}</p>}
    {active?<>
      <Feedback tone={stale?'warning':stream.state==='LIVE'?'success':'warning'} title={stream.state==='WAITING'?'Ожидаем трансляцию из Telegram':stale?'Позиция не обновляется':'Обновления из Telegram'}>
        {stream.state==='WAITING'?'Откройте переписку с ботом → скрепка или «+» → «Геопозиция» → «Транслировать геопозицию». Разовая точка не включает отслеживание.':`${stale?'Новых координат больше 90 секунд. ':''}Последнее обновление — ${stream.updatedAt?formatTime(stream.updatedAt):'ещё нет'}. Частота зависит от телефона и связи.`}
      </Feedback>
      <p className="muted">Сессия до {formatTime(stream.expiresAt)} или завершения заказа. Принято обновлений: {stream.updateCount}.</p>
      {chat}{stream.state==='LIVE'&&navigation&&<a className="button secondary wide" href={navigation} target="_blank" rel="noopener noreferrer">Открыть 2ГИС</a>}<Button variant="secondary" disabled={action.busy} onClick={()=>void stop()}>Остановить использование в Qadam</Button>
      <p className="muted">После остановки Qadam не принимает новые точки этого сообщения. Саму трансляцию остановите в Telegram. Для возврата к GPS откройте Qadam и разрешите передачу позиции.</p>
    </>:data?.allowed?<>
      {stream?.state==='STOPPED'&&<p className="muted">Предыдущая сессия закрыта. Для нового подключения нужна новая трансляция, отправленная после подтверждения.</p>}
      {!open?<Button variant="secondary" onClick={()=>{setOpen(true);setConsent(false);}}>Подключить трансляцию Telegram</Button>:<>
        <p>Разрешите использовать трансляцию для этого заказа, затем самостоятельно включите её в личном чате бота. Она может обновляться, пока открыт внешний навигатор.</p>
        <label className="courier-consent"><input type="checkbox" checked={consent} disabled={action.busy} onChange={e=>setConsent(e.target.checked)}/><span>Разрешаю использовать мою трансляцию Telegram для этого заказа до завершения или отключения.</span></label>
        <p className="muted">Позицию видят отправитель и администраторы. Непрерывность и частота зависят от разрешений телефона и связи. Привязка не включается для следующих заказов автоматически.</p>
        <Button disabled={!consent||action.busy} onClick={()=>void start()}>{action.busy?'Подключаем…':'Разрешить трансляцию для заказа'}</Button><Button variant="ghost" disabled={action.busy} onClick={()=>setOpen(false)}>Оставить GPS открытого Qadam</Button>
      </>}
    </>:null}
    {action.error&&<Feedback title={action.error} tone="error" role="alert"/>}
  </section>;
}
