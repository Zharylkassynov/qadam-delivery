'use client';
import {useEffect,useRef,useState} from 'react';
import {api} from '../lib/client-api';
import {recipientConsentText,recipientConsentVersion,whatsAppLink,type RecipientLink} from '../lib/recipient-tracking-types';
import type {Order} from '../lib/types';
import {Button,Feedback,formatTime} from './delivery-ui';

export function RecipientShare({order}:{order:Order}){
  const [link,setLink]=useState<RecipientLink|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[retry,setRetry]=useState(0);
  const saving=useRef(false);
  useEffect(()=>{const controller=new AbortController();let alive=true;
    setLink(null);setError('');setNotice('');
    void api<{link:RecipientLink}>(`/api/orders/${order.id}/recipient-link`,undefined,controller.signal).then(r=>{if(alive)setLink(r.link);}).catch(()=>{if(alive)setError('Не удалось проверить ссылку.');});
    return()=>{alive=false;controller.abort();};
  },[order.id,order.status,retry]);
  async function change(action:'create'|'revoke'){
    if(saving.current)return;saving.current=true;setBusy(true);setError('');setNotice('');
    try{const r=await api<{link:RecipientLink}>(`/api/orders/${order.id}/recipient-link`,{action});setLink(r.link);if(action==='revoke')setNotice('Ссылка отключена. Старый адрес больше не работает.');}
    catch(e){setError(e instanceof Error?e.message:'Не удалось изменить ссылку.');}
    finally{saving.current=false;setBusy(false);}
  }
  const url=link?.url,whatsapp=url?whatsAppLink(order.recipientPhone,url):null;
  return <section className="trust-section recipient-share"><h2>Отслеживание для получателя</h2>
    <p className="muted">Получатель увидит статус без входа в Qadam. По отдельному разрешению курьера — его имя и свежую позицию после забора посылки. Адрес забора, телефоны, фото и код вручения скрыты.</p>
    {order.surprise&&<Feedback title="Это сюрприз" tone="warning">Отправка ссылки сообщит получателю о доставке. Название магазина и сведения об отправителе скрыты.</Feedback>}
    <p>Сведения доступны каждому, у кого есть ссылка. Вы можете отключить её в любой момент.</p><p className="recipient-caption">До 7 суток, но не дольше 24 часов после завершения или отмены.</p>
    {error&&<Feedback title={error} tone="error" role="alert" action={!link?<Button variant="ghost" onClick={()=>setRetry(n=>n+1)}>Повторить проверку ссылки</Button>:undefined}/>}
    {!link&&!error&&<p role="status">Проверяем ссылку…</p>}
    {link&&!url&&<Button className="wide" disabled={busy} onClick={()=>void change('create')}>{busy?'Создаём…':'Создать ссылку'}</Button>}
    {url&&<><label className="recipient-url">Ссылка для получателя<input readOnly value={url} onFocus={e=>e.currentTarget.select()}/></label>
      {link.expiresAt&&<p className="recipient-caption">Доступна до {formatTime(link.expiresAt)}.</p>}
      {whatsapp?<a className="button primary wide" href={whatsapp} target="_blank" rel="noopener noreferrer">Отправить в WhatsApp</a>:<p className="muted">Для WhatsApp нужен полный международный номер. Скопируйте ссылку и отправьте её самостоятельно.</p>}
      <Button variant="secondary" className="wide" disabled={busy} onClick={()=>{void navigator.clipboard?.writeText(url).then(()=>setNotice('Ссылка скопирована.')).catch(()=>setNotice('Выделите ссылку в поле и скопируйте вручную.'));if(!navigator.clipboard)setNotice('Выделите ссылку в поле и скопируйте вручную.');}}>Скопировать ссылку</Button>
      <a href={url} target="_blank" rel="noopener noreferrer">Посмотреть страницу получателя</a>
      <Button variant="danger" className="wide" disabled={busy} onClick={()=>{if(window.confirm('Отключить ссылку? Прежний адрес перестанет работать.'))void change('revoke');}}>Отключить ссылку</Button>
    </>}{notice&&<p role="status">{notice}</p>}
  </section>;
}

export function RecipientSharingConsent(){
  const [enabled,setEnabled]=useState<boolean|null>(null),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{let alive=true;const controller=new AbortController();void api<{enabled:boolean}>('/api/courier/recipient-sharing',undefined,controller.signal).then(r=>{if(alive){setEnabled(r.enabled);setError('');}}).catch(()=>{if(alive)setError('Не удалось проверить разрешение.');});return()=>{alive=false;controller.abort();};},[retry]);
  async function save(value:boolean){if(busy)return;setBusy(true);setError('');try{const r=await api<{enabled:boolean}>('/api/courier/recipient-sharing',value?{enabled:true,consentVersion:recipientConsentVersion}:{enabled:false});setEnabled(r.enabled);setChecked(false);}catch{setError('Не удалось сохранить разрешение. Повторите запрос.');}finally{setBusy(false);}}
  return <section className="trust-section recipient-consent"><h2>Отслеживание для получателя</h2><p className="muted">Отправитель может поделиться ссылкой на доставку. Каждый, у кого есть ссылка, сможет открыть её без входа. Ваш телефон и контакты участников не показываются.</p>
    {error&&<Feedback title={error} tone="error" role="alert" action={enabled===null?<Button variant="ghost" onClick={()=>setRetry(n=>n+1)}>Повторить разрешение</Button>:undefined}/>}
    {enabled===null&&!error&&<p role="status">Проверяем разрешение…</p>}
    {enabled===true?<><Feedback title="Показ получателю разрешён" tone="success">Имя и свежая позиция доступны после забора посылки и до завершения или отмены.</Feedback><Button variant="danger" disabled={busy} onClick={()=>void save(false)}>Остановить показ получателю</Button></>:enabled===false?<><label className="courier-consent"><input type="checkbox" checked={checked} disabled={busy} onChange={e=>setChecked(e.target.checked)}/><span>{recipientConsentText}</span></label><Button disabled={busy||!checked} onClick={()=>void save(true)}>Разрешить показ получателю</Button></>:null}
    <p className="recipient-caption">Это отдельное разрешение. Его отзыв скрывает имя и позицию на странице получателя. Передача отправителю управляется настройками геолокации отдельно. Отказ не закрывает профиль и работу с принятым заказом.</p>
  </section>;
}
