'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {api,ApiError,sessionCredentials,sessionHeaders} from '../lib/client-api';
import {apiPath} from '../lib/api-origin';
import type {Order,OrderTrust,User} from '../lib/types';
import {Button,Feedback,formatTime} from './delivery-ui';

export function useTrustAction(){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const previous=useRef<{fingerprint:string;key:string}|null>(null);
  async function run<T>(path:string,body:Record<string,unknown>,idempotent=true):Promise<T|null>{
    const fingerprint=JSON.stringify([path,body]);
    if(previous.current?.fingerprint!==fingerprint)previous.current={fingerprint,key:crypto.randomUUID()};
    setBusy(true);setError('');
    try{return await api<T>(path,{...body,...(idempotent?{requestKey:previous.current.key}:{})});}
    catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить. Повторите попытку.');return null;}
    finally{setBusy(false);}
  }
  return{busy,error,setError,run};
}

export function useOrderTrust(order:Order){
  const [trust,setTrust]=useState<OrderTrust|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[version,setVersion]=useState(0);
  const reload=useCallback(()=>setVersion(n=>n+1),[]);
  useEffect(()=>{
    let alive=true,timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
    setLoading(true);setTrust(null);
    async function poll(first=false){
      if(!alive)return;
      if(document.hidden&&!first){timer=setTimeout(()=>void poll(),3000);return;}
      try{const result=await api<{trust:OrderTrust}>(`/api/orders/${order.id}/trust`,undefined,controller.signal);if(alive){setTrust(result.trust);setError('');}}
      catch(e){if(alive){setError(e instanceof Error?e.message:'Не удалось загрузить подтверждение.');if(e instanceof ApiError&&[401,403,404].includes(e.status))setTrust(null);}}
      finally{if(alive)setLoading(false);}
      if(alive)timer=setTimeout(()=>void poll(),3000);
    }
    void poll(true);return()=>{alive=false;clearTimeout(timer);controller.abort();};
  },[order.id,order.status,order.assignmentVersion,order.routeVersion,version]);
  return{trust,error,loading,reload};
}

export function CodeReset({order,onDone,handoffStage}:{order:Order;onDone:()=>void;handoffStage?:'PICKUP'|'DROPOFF'}){
  const [open,setOpen]=useState(false),[reason,setReason]=useState('');const action=useTrustAction();
  return <div className="trust-section">{!open?<Button variant="secondary" onClick={()=>setOpen(true)}>Выпустить новый код</Button>:<form className="trust-section" onSubmit={e=>{e.preventDefault();void action.run(`/api/orders/${order.id}/${handoffStage?'handoff-code':'code'}`,{expectedVersion:order.assignmentVersion??0,reason:reason.trim(),...(handoffStage?{stage:handoffStage,expectedRouteVersion:order.routeVersion??0,reset:true}:{})}).then(result=>{if(result){setOpen(false);setReason('');onDone();}});}}>
    <Feedback title="Прежний код перестанет действовать" tone="warning">Передайте новый код получателю. Не более трёх перевыпусков в час.</Feedback>
    <div className="field"><label htmlFor="code-reset-reason">Причина перевыпуска</label><textarea id="code-reset-reason" required minLength={5} maxLength={500} value={reason} disabled={action.busy} onChange={e=>setReason(e.target.value)}/></div>
    {action.error&&<Feedback title={action.error} tone="error" role="alert"/>}
    <Button type="submit" disabled={action.busy||reason.trim().length<5}>{action.busy?'Сохраняем…':'Подтвердить перевыпуск'}</Button><Button variant="ghost" disabled={action.busy} onClick={()=>setOpen(false)}>Оставить прежний код</Button>
  </form>}</div>;
}

function CustomerCode({order}:{order:Order}){
  const [shown,setShown]=useState(false),[code,setCode]=useState<string|null>(null),[error,setError]=useState(''),[copy,setCopy]=useState(''),[version,setVersion]=useState(0);
  async function copyCode(){
    try{if(!code||!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');await navigator.clipboard.writeText(code);setCopy('Код скопирован');}
    catch{setCopy('Выделите код и скопируйте вручную.');}
  }
  useEffect(()=>{
    if(!shown)return;let alive=true,timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
    async function poll(){
      if(!alive)return;
      if(!document.hidden){try{const result=await api<{code:string}>(`/api/orders/${order.id}/code`,undefined,controller.signal);if(alive){setCode(result.code);setError('');}}catch(e){if(alive){setCode(null);setError(e instanceof Error?e.message:'Не удалось загрузить код.');}}}
      if(alive)timer=setTimeout(()=>void poll(),3000);
    }
    void poll();return()=>{alive=false;clearTimeout(timer);controller.abort();};
  },[shown,order.id,order.assignmentVersion,version]);
  return <section className="trust-section"><h2>Код при вручении</h2><p className="muted">Передайте получателю. Попросите назвать код после передачи посылки.</p>
    {!shown?<Button variant="secondary" onClick={()=>setShown(true)}>Показать код</Button>:<>{code?<><p className="delivery-code" aria-label={`Код: ${code.split('').join(' ')}`}>{code}</p><div className="trust-pair"><Button variant="secondary" onClick={()=>void copyCode()}>Скопировать</Button><Button variant="ghost" onClick={()=>{setShown(false);setCode(null);setCopy('');}}>Скрыть код</Button></div>{copy&&<p role="status" className="muted">{copy}</p>}</>:error?<Feedback title={error} tone="error" role="alert" action={<Button variant="ghost" onClick={()=>setVersion(n=>n+1)}>Повторить</Button>}/>:<p role="status">Загружаем код…</p>}</>}
    <CodeReset order={order} onDone={()=>{setCode(null);setVersion(n=>n+1);setShown(true);setCopy('');}}/>
  </section>;
}

function ProofPhoto({order,photo}:{order:Order;photo:OrderTrust['photo']}){
  const [url,setUrl]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>{controller.current?.abort();},[]);
  useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
  useEffect(()=>{setUrl('');setError('');controller.current?.abort();},[order.id,order.assignmentVersion,photo?.state]);
  async function show(){
    controller.current?.abort();const current=new AbortController();controller.current=current;setBusy(true);setError('');
    try{
      const response=await fetch(apiPath(`/api/orders/${order.id}/photo`),{credentials:sessionCredentials(),headers:sessionHeaders(),signal:current.signal,cache:'no-store'});
      if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error??'Не удалось открыть фото.');}
      if(response.headers.get('content-type')!=='image/jpeg')throw new Error('Не удалось открыть фото.');
      const blob=await response.blob();if(!current.signal.aborted&&controller.current===current)setUrl(URL.createObjectURL(blob));
    }catch(e){if(e instanceof Error&&e.name!=='AbortError')setError(e.message);}
    finally{if(controller.current===current)setBusy(false);}
  }
  return <section className="trust-section"><h2>Фото вручения</h2>{photo?.state==='EXPIRED'?<p className="muted">Срок доступа закончился. Фото больше не выдаётся в приложении.</p>:photo?.state==='READY'?<>
    {url?<><img className="trust-photo" src={url} alt="Упаковка в месте вручения"/><Button variant="ghost" onClick={()=>setUrl('')}>Закрыть фото</Button></>:<Button variant="secondary" disabled={busy} onClick={()=>void show()}>{busy?'Открываем…':'Посмотреть фото'}</Button>}
    <p className="muted">Доступно до {formatTime(photo.expiresAt)}.</p>{error&&<Feedback title={error} tone="error" role="alert"/>}
  </>:<p className="muted">{order.status==='DELIVERED'?'Фото недоступно. По вопросам доставки напишите команде.':'Курьер приложит фото перед завершением доставки.'}</p>}</section>;
}

function DeliveryRating({order,rating,onDone}:{order:Order;rating:OrderTrust['rating'];onDone:()=>void}){
  const [score,setScore]=useState(0),[comment,setComment]=useState('');const action=useTrustAction();
  return <section className="trust-section"><h2>{rating?'Ваш отзыв':'Как прошла доставка?'}</h2>{rating?<><p className="trust-rating-result">{rating.score} из 5</p>{rating.comment&&<p className="pre-wrap">{rating.comment}</p>}<p className="muted">Отзыв сохранён. Для исправления напишите команде Qadam.</p></>:<form className="trust-section" onSubmit={e=>{e.preventDefault();void action.run(`/api/orders/${order.id}/rating`,{score,comment:comment.trim()},false).then(result=>{if(result)onDone();});}}>
    <fieldset className="trust-rating"><legend className="sr-only">Оценка доставки от 1 до 5</legend>{[1,2,3,4,5].map(value=><label key={value}><input type="radio" name="delivery-rating" value={value} required checked={score===value} disabled={action.busy} onChange={()=>setScore(value)}/><span aria-hidden="true">★</span><small>{value}</small></label>)}</fieldset>
    <div className="field"><label htmlFor="rating-comment">Комментарий <span className="muted">· необязательно</span></label><textarea id="rating-comment" maxLength={500} value={comment} disabled={action.busy} onChange={e=>setComment(e.target.value)}/></div>
    <p className="muted">Отзыв увидит команда Qadam. Курьеру он не показывается.</p>{action.error&&<Feedback title={action.error} tone="error" role="alert"/>}
    <Button type="submit" disabled={action.busy||!score}>{action.busy?'Сохраняем…':'Сохранить отзыв'}</Button>
  </form>}</section>;
}

export function OrderTrustPanel({order,user}:{order:Order;user:User}){
  const data=useOrderTrust(order);const owner=order.customerId===user.id;
  return <div className="order-trust">{data.error?<Feedback title="Подтверждение не обновлено" tone="error" role="alert" action={<Button variant="ghost" onClick={data.reload}>Повторить</Button>}>{data.error}</Feedback>:data.loading&&!data.trust?<p role="status">Загружаем подтверждение…</p>:null}
    {data.trust&&<>{!order.handoffRequired&&order.codeRequired&&owner&&!['DELIVERED','CANCELLED'].includes(order.status)&&<CustomerCode key={`${order.id}:${order.assignmentVersion}`} order={order}/>}
      {order.photoRequired&&<ProofPhoto order={order} photo={data.trust.photo}/>}
      {!order.handoffRequired&&order.codeRequired&&user.isAdmin&&!owner&&data.trust.canResetCode&&<section className="trust-section"><h2>Код при вручении</h2><p className="muted">Код видит только отправитель. Команда может выпустить новый с сохранением причины.</p><CodeReset order={order} onDone={data.reload}/></section>}
      {order.handoffRequired&&user.isAdmin&&!owner&&['ACCEPTED','PICKED_UP','IN_TRANSIT'].includes(order.status)&&<section className="trust-section"><h2>{order.status==='ACCEPTED'?'Код забора':'Код вручения'}</h2><p className="muted">Код видит отправитель. Новый выпуск сохраняется в истории.</p><CodeReset order={order} handoffStage={order.status==='ACCEPTED'?'PICKUP':'DROPOFF'} onDone={data.reload}/></section>}
      {order.status==='DELIVERED'&&(owner?<DeliveryRating order={order} rating={data.trust.rating} onDone={data.reload}/>:user.isAdmin&&data.trust.rating?<section className="trust-section"><h2>Отзыв отправителя</h2><p>{data.trust.rating.score} из 5</p><p className="pre-wrap">{data.trust.rating.comment}</p></section>:null)}
    </>}
  </div>;
}
