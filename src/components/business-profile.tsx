'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import { api } from '../lib/client-api';
import type { BusinessProfile } from '../lib/business-profiles';
import type { PhoneProfile } from '../lib/user-profiles';
import { Button,Feedback,Skeletons } from './delivery-ui';

export type BusinessDraft=Pick<BusinessProfile,'name'|'pickupAddress'|'pickupDetails'> & {pickupPoint:BusinessProfile['pickupPoint']|null};
export const emptyBusiness:BusinessDraft={name:'',pickupAddress:'',pickupPoint:null,pickupDetails:''};
const message=(e:unknown)=>e instanceof Error?e.message:'Не удалось сохранить магазин. Повторите попытку.';
export function useBusinessProfile(enabled:boolean){
  const [profile,setProfile]=useState<BusinessProfile|null>(null),[loading,setLoading]=useState(enabled),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [revision,setRevision]=useState(0);const pending=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    if(!enabled)return;const controller=new AbortController();setLoading(true);setError('');
    void api<{profile:BusinessProfile|null}>('/api/business-profile',undefined,controller.signal).then(data=>{if(!controller.signal.aborted)setProfile(data.profile);}).catch(e=>{if(!controller.signal.aborted)setError(message(e));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[enabled,revision]);
  async function mutate(draft:BusinessDraft|null){
    if(pending.current)return false;pending.current=true;setBusy(true);setError('');
    try{const data=await api<{profile?:BusinessProfile}>('/api/business-profile',draft??{},undefined,draft?'PUT':'DELETE');if(alive.current)setProfile(data.profile??null);return true;}
    catch(e){if(alive.current)setError(message(e));return false;}
    finally{pending.current=false;if(alive.current)setBusy(false);}
  }
  const refresh=useCallback(()=>setRevision(n=>n+1),[]);
  return {profile,loading,busy,error,refresh,save:(draft:BusinessDraft)=>mutate(draft),remove:()=>mutate(null)};
}

export function BusinessProfilePanel({profile,draft,onChange,mode,onMode,phone,onPhone,onPoint,loading,busy,error,onRetry}:{
  profile:BusinessProfile|null;draft:BusinessDraft;onChange:(draft:BusinessDraft)=>void;mode:'view'|'edit'|'delete';
  onMode:(mode:'view'|'edit'|'delete')=>void;phone:PhoneProfile;onPhone:()=>void;onPoint:()=>void;
  loading:boolean;busy:boolean;error:string;onRetry:()=>void;
}){
  if(loading)return <><h1 tabIndex={-1}>Мой магазин</h1><Skeletons/></>;
  if(mode==='delete')return <div className="form-fields"><div className="screen-heading"><h1 tabIndex={-1}>Удалить профиль магазина?</h1><p>Название, адрес и точка будут удалены из профиля.</p></div><Feedback title="История заказов сохранится" tone="warning">Созданные доставки останутся без изменений. Вы сможете добавить магазин снова.</Feedback>{error&&<Feedback title={error} tone="error" role="alert"/>}</div>;
  return <div className="form-fields"><div className="screen-heading"><h1 tabIndex={-1}>Мой магазин</h1><p>{mode==='edit'?'Данные используются для подстановки в новые заказы.':'Сохраните адрес для регулярных отправлений. Личные доставки доступны всегда.'}</p></div>
    {error&&<Feedback title={error} tone="error" role="alert" action={mode==='view'?<Button variant="ghost" onClick={onRetry}>Повторить загрузку</Button>:undefined}/>}
    {mode==='edit'?<form id="business-form" onSubmit={e=>e.preventDefault()}><fieldset className="form-fields" disabled={busy}>
      <div className="field"><label htmlFor="business-name">Название магазина</label><input id="business-name" value={draft.name} minLength={2} maxLength={100} required autoComplete="organization" onChange={e=>onChange({...draft,name:e.target.value})}/></div>
      <div className="field"><label htmlFor="business-address">Адрес отправления</label><input id="business-address" value={draft.pickupAddress} minLength={5} maxLength={300} required onChange={e=>onChange({...draft,pickupAddress:e.target.value,pickupPoint:null})}/><small className="field-hint">Подтвердите точку входа на карте.</small></div>
      <Button variant="secondary" onClick={onPoint}>{draft.pickupPoint?'Уточнить точку на карте':'Выбрать адрес и точку'}</Button>
      <p className="muted" role="status">{draft.pickupPoint?'Точка входа выбрана.':'Точка входа ещё не выбрана.'}</p>
      <div className="field"><label htmlFor="business-entrance">Как найти вход</label><input id="business-entrance" value={draft.pickupDetails} maxLength={200} onChange={e=>onChange({...draft,pickupDetails:e.target.value})}/><small className="field-hint">Необязательно · до 200 символов</small></div>
      <section className="review-section"><h2>Контакт для доставки</h2>{phone.phoneVerified?<><p>{phone.phone}</p><p className="muted">Ваш подтверждённый номер из Telegram. Он откроется курьеру после принятия.</p></>:<><p className="muted">Подтвердите свой номер для отправлений из магазина.</p><Button variant="secondary" onClick={onPhone}>Подтвердить телефон</Button></>}</section>
    </fieldset></form>:profile?<><section className="review-section"><h2>{profile.name}</h2><p>{profile.pickupAddress}</p>{profile.pickupDetails&&<p>{profile.pickupDetails}</p>}<p className="muted">Точка входа сохранена.</p></section><p className="muted">Контакт: {phone.phoneVerified?phone.phone:'подтвердите свой номер'}</p><Button variant="secondary" onClick={()=>onMode('edit')}>Изменить данные</Button><button type="button" className="text-button" onClick={()=>onMode('delete')}>Удалить профиль магазина</button><p className="muted">Изменения не затронут уже созданные заказы.</p></>:<Feedback title="Удобно для регулярных отправлений">Один адрес магазина, точка входа и ваш контакт. Новый заказ можно отправить из магазина или с другого адреса.</Feedback>}
  </div>;
}
