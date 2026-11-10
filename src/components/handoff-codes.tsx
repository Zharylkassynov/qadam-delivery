'use client';
import {useEffect,useState} from 'react';
import {api} from '../lib/client-api';
import type {Order} from '../lib/types';
import {Button,Feedback} from './delivery-ui';
import {useOrderTrust,useTrustAction} from './order-trust';

export function HandoffCodes({order}:{order:Order}){
  const data=useOrderTrust(order),action=useTrustAction();
  const pickup=order.status==='ACCEPTED',stage=pickup?'PICKUP':'DROPOFF';
  const [shown,setShown]=useState(false),[code,setCode]=useState<string|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[reset,setReset]=useState(false),[reason,setReason]=useState('');
  useEffect(()=>{
    if(!shown)return;let alive=true,timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
    async function poll(){
      if(!alive)return;
      if(!document.hidden)try{const result=await api<{code:string|null}>(`/api/orders/${order.id}/handoff-code?stage=${stage}`,undefined,controller.signal);if(alive){setCode(result.code);setError('');}}catch(e){if(alive){setCode(null);setError(e instanceof Error?e.message:'Код не загрузился.');}}
      if(alive)timer=setTimeout(()=>void poll(),3000);
    }
    void poll();return()=>{alive=false;clearTimeout(timer);controller.abort();};
  },[shown,order.id,stage,order.assignmentVersion,order.routeVersion,revision]);
  async function issue(isReset=false){
    const ok=await action.run(`/api/orders/${order.id}/handoff-code`,{expectedVersion:order.assignmentVersion??0,expectedRouteVersion:order.routeVersion??0,stage,reset:isReset,...(isReset?{reason:reason.trim()}:{})});
    if(ok){setCode(null);setShown(true);setRevision(n=>n+1);setReset(false);setReason('');data.reload();}
  }
  const digits=order.recipientPhone?.replace(/\D/g,'');
  const whatsapp=code&&digits&&/^7\d{10}$/.test(digits)?`https://wa.me/${digits}?text=${encodeURIComponent(`Qadam Delivery: код получения ${code}. Назовите его курьеру только после получения посылки. Не сообщайте заранее.`)}`:null;
  return <section className="handoff-code-card" aria-label={pickup?'Код забора':'Код вручения'}>
    <div><h2>{pickup?'Код отправителя':'Код для получателя'}</h2><p className="muted">{pickup?'Назовите курьеру, когда передадите посылку.':'Передайте получателю. Он назовёт код после вручения.'}</p></div>
    {(data.error||error||action.error)&&<Feedback title={action.error||error||data.error} tone="error" role="alert"/>}
    {!shown?<Button variant="secondary" className="wide" disabled={action.busy||!data.trust||!!data.error||(pickup&&!data.trust.handoff?.ready)} onClick={()=>void issue()}>{action.busy?'Открываем…':pickup?'Показать код забора':'Показать код вручения'}</Button>:code?<><p className="delivery-code" aria-label={`Код: ${code.split('').join(' ')}`}>{code}</p>
      {whatsapp&&<a className="button primary wide" href={whatsapp} target="_blank" rel="noopener noreferrer">Отправить код в WhatsApp</a>}
      <Button variant="ghost" onClick={()=>{setShown(false);setCode(null);}}>Скрыть код</Button></>:<p role="status" className="muted">{data.trust?.handoff?.codeReady?'Загружаем код…':'Код недоступен. Выпустите новый.'}</p>}
    {pickup&&!data.trust?.handoff?.ready&&<p className="field-hint">Код откроется, когда курьер будет у отправителя со свежей геопозицией.</p>}
    {shown&&<details className="handoff-code-options"><summary>Нужен новый код?</summary>{!reset?<Button variant="secondary" disabled={action.busy} onClick={()=>setReset(true)}>Выпустить новый</Button>:<form onSubmit={e=>{e.preventDefault();void issue(true);}}>
      <div className="field"><label htmlFor="handoff-reset-reason">Почему меняем код</label><input id="handoff-reset-reason" required minLength={5} maxLength={500} value={reason} disabled={action.busy} onChange={e=>setReason(e.target.value)}/></div><p className="field-hint">Прежний перестанет действовать.</p><Button type="submit" disabled={action.busy||reason.trim().length<5}>Подтвердить</Button>
    </form>}</details>}
  </section>;
}

export function HandoffStart({order,busy,onOpen}:{order:Order;busy:boolean;onOpen:()=>void}){
  const data=useOrderTrust(order),pickup=order.status==='ACCEPTED';
  return <div className="handoff-start">{data.error?<p data-telegram-keep className="field-error" role="alert">{data.error}</p>:data.trust?.handoff&&!data.trust.handoff.ready?<p data-telegram-keep className="field-hint" role="status">{data.trust.handoff.message}</p>:null}
    <Button className="wide" disabled={busy} onClick={onOpen}>{pickup?'Подтвердить забор':'Подтвердить вручение'}</Button>
  </div>;
}
