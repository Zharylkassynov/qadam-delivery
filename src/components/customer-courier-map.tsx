'use client';
import {useEffect,useState} from 'react';
import {api} from '../lib/client-api';
import type {Order} from '../lib/types';
import {courierMapBounds,type MapBounds,type NearbyCourier} from '../lib/courier-map';
import {DeliveryMap,type MapMarker} from './delivery-map';
import {formatTime} from './delivery-ui';

export function CustomerCourierMap({order,markers,compact=false}:{order?:Order;markers:MapMarker[];compact?:boolean}) {
  const pickup=markers.find(p=>p.kind==='pickup');
  const [expanded,setExpanded]=useState(false);
  const [bounds,setBounds]=useState<MapBounds>(()=>compact&&pickup?{south:pickup.latitude-.004,north:pickup.latitude+.004,west:pickup.longitude-.006,east:pickup.longitude+.006}:courierMapBounds),[points,setPoints]=useState<NearbyCourier[]>([]);
  const [error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0),[now,setNow]=useState(()=>Date.now());
  const assigned=Boolean(order?.courierId);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),5000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    if(assigned){setPoints([]);setLoading(false);return;}
    let alive=true,fetching=false;const controller=new AbortController();
    async function load(){
      if(fetching||document.hidden)return;fetching=true;
      try {
        const south=Math.max(bounds.south,courierMapBounds.south),north=Math.min(bounds.north,courierMapBounds.north),west=Math.max(bounds.west,courierMapBounds.west),east=Math.min(bounds.east,courierMapBounds.east);
        if(south>=north||west>=east){if(alive)setPoints([]);return;}
        const query=new URLSearchParams({south:String(south),north:String(north),west:String(west),east:String(east)});
        const data=await api<{couriers:NearbyCourier[]}>(`/api/couriers/nearby?${query}`,undefined,controller.signal);
        if(alive){setPoints(data.couriers);setError('');setNow(Date.now());}
      }catch(e){if(alive)setError(e instanceof Error?e.message:'Не удалось обновить позиции.');}
      finally{fetching=false;if(alive)setLoading(false);}
    }
    void load();const timer=setInterval(()=>void load(),15000);
    window.addEventListener('focus',load);document.addEventListener('visibilitychange',load);
    return()=>{alive=false;controller.abort();clearInterval(timer);window.removeEventListener('focus',load);document.removeEventListener('visibilitychange',load);};
  },[assigned,bounds,refresh]);
  const fresh=points.filter(p=>now-Date.parse(p.capturedAt)<=90000&&p.latitude>=bounds.south&&p.latitude<=bounds.north&&p.longitude>=bounds.west&&p.longitude<=bounds.east),count=fresh.reduce((sum,p)=>sum+p.count,0);
  const location=order?.courierLocation,stopped=location?.sharingStopped===true,stale=Boolean(location&&(stopped||now-Date.parse(location.capturedAt)>90000));
  const source=location?.source==='TELEGRAM_LIVE'?'Источник — трансляция Telegram. ':'';
  const courierMarkers:MapMarker[]=assigned?location?[{...location,kind:'courier',stale,label:`Ваш курьер · ${formatTime(location.capturedAt)}${stale?' · позиция устарела':''}`}]:[]:fresh.map(p=>({...p,kind:'courier',approximate:true,label:`${p.count===1?'Свободный курьер':`${p.count} курьера`} · примерное расположение`}));
  const content=<>
    {(!compact||expanded)&&<DeliveryMap markers={[...markers,...courierMarkers]} center={compact?pickup:undefined} onBoundsChange={assigned?undefined:setBounds}/>}
    <div className={`customer-map-status ${stale?'map-status-stale':''}`} role="status">
      <strong>{assigned?location?stopped?'Передача геопозиции остановлена':stale?'Позиция вашего курьера устарела':`Ваш курьер · позиция обновлена в ${formatTime(location.capturedAt)}`:'Курьер ещё не передал позицию':loading?'Загружаем позиции курьеров…':error?'Не удалось обновить позиции':count?`${count} ${courierNoun(count)} на карте`:'Свежих позиций пока нет'}</strong>
      <p>{source}{assigned?location?stopped?'На карте последняя известная позиция.':stale?'Новых координат нет более 90 секунд. Курьер мог переместиться.':location.accuracy===null?'Точность не указана устройством.':`Точность около ${Math.round(location.accuracy)} м. Новые точки появляются автоматически.`:'Координаты появятся, когда курьер включит смену и разрешит передачу позиции.':error?'Проверьте интернет и повторите. Создание доставки доступно.':count?'Примерное расположение свободных курьеров. Курьер назначается после размещения заказа.':'Доставку можно оформить. Курьеры появятся, когда включат смену и передадут позицию.'}</p>
      {!assigned&&error&&<button type="button" className="text-button" onClick={()=>setRefresh(n=>n+1)}>Повторить обновление</button>}
    </div>
  </>;
  return compact?<details className="checkout-couriers" onToggle={event=>setExpanded(event.currentTarget.open)}><summary><span><strong>Курьеры рядом</strong><small>{loading?'Загружаем позиции…':error?'Не удалось обновить позиции':count?`${count} ${courierNoun(count)} в этой области`:'Свежих позиций пока нет'}</small></span><span aria-hidden="true">⌄</span></summary>{expanded&&<div className="checkout-couriers-map">{content}</div>}</details>:content;
}
function courierNoun(count:number){const form=new Intl.PluralRules('ru-KZ').select(count);return form==='one'?'свободный курьер':form==='few'?'свободных курьера':'свободных курьеров';}
