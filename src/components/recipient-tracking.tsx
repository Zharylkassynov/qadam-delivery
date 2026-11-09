'use client';
import {useEffect,useRef,useState} from 'react';
import {apiPath} from '../lib/api-origin';
import type {RecipientDelivery} from '../lib/recipient-tracking-types';
import {Button,Feedback,Icon} from './delivery-ui';
import {RecipientMap} from './recipient-map';
import {serviceTimezone} from '../lib/service-area';

const time=(s:string)=>new Intl.DateTimeFormat('ru-KZ',{timeZone:serviceTimezone,day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}).format(new Date(s));
const titles={CREATED:'Заказ создан',SEARCHING_FOR_COURIER:'Ищем курьера',ACCEPTED:'Курьер назначен',PICKED_UP:'Посылка у курьера',IN_TRANSIT:'Посылка в пути',DELIVERED:'Доставка завершена',CANCELLED:'Доставка отменена'};
export function RecipientTracking({token}:{token:string}){
  const [data,setData]=useState<RecipientDelivery|null>(null),[error,setError]=useState(''),[unavailable,setUnavailable]=useState(false),[busy,setBusy]=useState(true),[attempt,setAttempt]=useState(0),[tick,setTick]=useState(0);
  const received=useRef(0),finished=useRef(false);
  useEffect(()=>{
    let alive=true,pending=false,next=0;const controller=new AbortController();
    finished.current=false;setData(null);setUnavailable(false);setBusy(true);setError('');
    async function load(){
      if(pending||document.hidden||finished.current||Date.now()<next)return;
      pending=true;
      const started=performance.now();
      try{
        const response=await fetch(apiPath('/api/recipient-tracking'),{headers:{'X-Qadam-Tracking':token},credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)])});
        if(!alive)return;
        if(response.status===404){setData(null);setUnavailable(true);finished.current=true;return;}
        if(!response.ok){if(response.status===429)next=Date.now()+60000;throw new Error(response.status===429?'Слишком много запросов. Повторим проверку через минуту.':'Не удалось обновить доставку. Проверьте интернет и повторите.');}
        const result=await response.json() as {delivery:RecipientDelivery};if(!alive)return;
        // Count the full request time too; a delayed response must not extend GPS freshness.
        received.current=started;setData(result.delivery);setError('');
        finished.current=['DELIVERED','CANCELLED'].includes(result.delivery.status);
      }catch(e){if(alive&&!controller.signal.aborted)setError(e instanceof Error&&e.name!=='TimeoutError'?e.message:'Не удалось обновить доставку. Проверьте интернет и повторите.');}
      finally{pending=false;if(alive)setBusy(false);}
    }
    const timer=setInterval(()=>void load(),15000);
    const visibility=()=>{setTick(n=>n+1);if(!document.hidden)void load();};
    document.addEventListener('visibilitychange',visibility);void load();
    return()=>{alive=false;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visibility);};
  },[token,attempt]);
  useEffect(()=>{const timer=setInterval(()=>setTick(n=>n+1),1000);return()=>clearInterval(timer);},[]);
  void tick;
  const elapsed=typeof performance==='undefined'?0:Math.max(0,performance.now()-received.current);
  const serverNow=data?Date.parse(data.checkedAt)+elapsed:0;
  const expired=!!data&&serverNow>=Date.parse(data.expiresAt);
  const location=data?.location;
  const fresh=!!location&&!error&&!documentHidden()&&serverNow-Date.parse(location.capturedAt)<=90000&&serverNow-Date.parse(location.receivedAt)<=90000;
  const final=!!data&&['DELIVERED','CANCELLED'].includes(data.status);
  const index=data?['CREATED','SEARCHING_FOR_COURIER','ACCEPTED','PICKED_UP','IN_TRANSIT','DELIVERED'].indexOf(data.status):-1;
  return <main className="recipient-page"><header className="recipient-brand"><Icon type="box"/><strong>Qadam Delivery</strong><span>Получателю</span></header><div className="recipient-body">
    {unavailable||expired?<><h1>Ссылка недоступна</h1><p>Срок мог закончиться или отправитель отключил доступ.</p><p className="muted">Попросите отправителя прислать новую ссылку.</p></>:<>
      <h1>Ваша доставка</h1>
      {busy&&!data&&<p role="status">Проверяем доставку…</p>}
      {error&&<Feedback title="Не удалось обновить доставку" tone="warning" role="alert"><p>{error}</p>{data&&<p>Последняя успешная проверка: {time(data.checkedAt)}.</p>}<Button variant="secondary" onClick={()=>setAttempt(n=>n+1)}>Повторить</Button></Feedback>}
      {data&&<><Feedback title={titles[data.status]} tone={data.status==='DELIVERED'?'success':data.status==='CANCELLED'?'warning':'info'}><p>{final?'Позиция курьера больше не показывается.':`Последний статус проверен: ${time(data.checkedAt)}.`}</p></Feedback>
        {data.businessName&&<p>Отправление из магазина «{data.businessName}»</p>}
        {!final&&data.deliverAfter&&data.deliverBefore&&<section className="recipient-window"><h2>Желаемый интервал</h2><p>{time(data.deliverAfter)} — {new Intl.DateTimeFormat('ru-KZ',{timeZone:serviceTimezone,hour:'2-digit',minute:'2-digit'}).format(new Date(data.deliverBefore))}</p><p className="muted">Пожелание отправителя, не обещание точного времени прибытия.</p></section>}
        {!final&&data.courierName&&<section className="recipient-position"><h2>Курьер: {data.courierName}</h2>
          {fresh&&location?<>{data.mapAvailable?<RecipientMap token={token} location={location}/>:<Feedback title="Карта недоступна" tone="warning">Статус доставки доступен.</Feedback>}<h3>Последняя позиция курьера</h3><p className="muted">Обновлено: {time(location.capturedAt)}. {location.accuracy!==null&&`Точность около ${Math.round(location.accuracy)} м.`}</p><p className="muted">Позиция может обновляться с задержкой.</p></>:data.lastMeasuredAt?<Feedback title="Нет свежей позиции" tone="warning">Последнее измерение: {time(data.lastMeasuredAt)}. Точку скрыли, потому что курьер мог переместиться. Статус доставки остаётся доступен.</Feedback>:null}
        </section>}
        {!final&&!data.lastMeasuredAt&&!fresh&&data.status!=='SEARCHING_FOR_COURIER'&&data.status!=='CREATED'&&<Feedback title="Позиция пока недоступна">Она появится после получения посылки, если курьер разрешил показ получателю и передал свежие координаты.</Feedback>}
        {data.status!=='CANCELLED'&&<section className="recipient-steps"><h2>Этапы доставки</h2><ol>{['Ищем курьера','Курьер назначен','Посылка у курьера','В пути к получателю','Доставлено'].map((label,i)=><li key={label} className={i+1<index?'done':i+1===index?'current':''}>{label}</li>)}</ol></section>}
        <p className="recipient-caption">Не пересылайте ссылку посторонним. Телефоны и адрес отправителя здесь скрыты.</p>
      </>}
    </>}
    </div><footer className="recipient-footer"><a href="/rules">Правила сервиса</a><a href="/privacy">Конфиденциальность</a><span>Команда Qadam</span></footer></main>;
}
function documentHidden(){return typeof document!=='undefined'&&document.hidden;}
