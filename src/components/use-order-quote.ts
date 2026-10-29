'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import { api } from '../lib/client-api';
import type { OrderQuote } from '../lib/types';
import { orderPayload,type OrderDraft } from './order-form';

export function useOrderQuote(active:boolean,draft:OrderDraft){
  const [enabled,setEnabled]=useState<boolean|null>(null),[quote,setQuote]=useState<OrderQuote|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[expired,setExpired]=useState(false),[attempt,setAttempt]=useState(0);
  const previousQuote=useRef<OrderQuote|null>(null);
  const [previousPrice,setPreviousPrice]=useState<number|null>(null);
  const fingerprint=JSON.stringify(orderPayload(draft));
  useEffect(()=>{
    if(!active)return;
    const controller=new AbortController();let alive=true;
    setQuote(null);setBusy(true);setError('');setExpired(false);setEnabled(null);
    const timer=setTimeout(()=>{void (async()=>{
      try{
        const status=await api<{enabled:boolean}>('/api/orders/quote',undefined,controller.signal);
        if(!alive)return;setEnabled(status.enabled);
        if(!status.enabled)return;
        const payload=JSON.parse(fingerprint);
        if(!payload.pickupPoint||!payload.destinationPoint)throw new Error('Укажите обе точки на карте для расчёта стоимости.');
        const result=await api<{quote:OrderQuote}>('/api/orders/quote',{...payload,transport:'CAR'},controller.signal);
        if(alive){setPreviousPrice(previousQuote.current?.priceKzt??null);previousQuote.current=result.quote;setQuote(result.quote);}
      }catch(failure){if(alive)setError(failure instanceof Error?failure.message:'Не удалось рассчитать стоимость.');}
      finally{if(alive)setBusy(false);}
    })();},200);
    return()=>{alive=false;controller.abort();clearTimeout(timer);};
  },[active,fingerprint,attempt]);
  const retry=useCallback(()=>setAttempt(value=>value+1),[]);
  const expire=useCallback(()=>setExpired(true),[]);
  return {enabled,quote,previousPrice,busy,error,expired,retry,expire,ready:enabled===false||enabled===true&&!!quote&&!busy&&!error&&!expired};
}
