'use client';

import {useEffect,useRef,useState} from 'react';
import type {Order} from '../lib/types';
import {ApplicationScreen} from './courier-onboarding';
import {Button,Feedback,RouteCard,orderNumber} from './delivery-ui';
import {useOrderTrust,useTrustAction} from './order-trust';
import {CourierGpsStatus,useCourierPresence} from './courier-presence';
import {formatDistance} from '../lib/geo-distance';

async function preparePhoto(file:File){
  if(file.size>25*1024*1024)throw new Error('Выберите снимок размером до 25 МБ. Перед отправкой мы его сожмём.');
  const source=URL.createObjectURL(file);
  try{
    const image=new Image();await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('Не удалось открыть снимок. Выберите JPEG или PNG.'));image.src=source;});
    if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>48000000)throw new Error('Выберите снимок меньшего разрешения.');
    const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const context=canvas.getContext('2d');if(!context)throw new Error('Обработка фото недоступна на устройстве.');
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
    let blob:Blob|null=null;
    for(const quality of [.82,.7,.6,.45]){blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=1048576)break;}
    if(!blob||blob.size>1048576)throw new Error('Фото не удалось сжать до 1 МБ. Выберите другой снимок.');
    const bytes=new Uint8Array(await blob.arrayBuffer()),parts:string[]=[];
    for(let i=0;i<bytes.length;i+=32768)parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
    return{blob,base64:btoa(parts.join('')),saved:false};
  }finally{URL.revokeObjectURL(source);}
}

export function DeliveryHandoff({order,busy,error,onBack,onComplete}:{order:Order;busy:boolean;error:string;onBack:()=>void;onComplete:(body:Record<string,unknown>)=>Promise<boolean>}){
  const data=useOrderTrust(order),upload=useTrustAction(),presence=useCourierPresence();
  const secure=!!order.handoffRequired,pickup=secure&&order.status==='ACCEPTED';
  const photoRequired=!pickup&&order.photoRequired;
  const [photo,setPhoto]=useState<Awaited<ReturnType<typeof preparePhoto>>|null>(null),[preview,setPreview]=useState(''),[preparing,setPreparing]=useState(false),[photoError,setPhotoError]=useState('');
  const [code,setCode]=useState(''),[handed,setHanded]=useState(false);
  const camera=useRef<HTMLInputElement>(null),gallery=useRef<HTMLInputElement>(null),alive=useRef(true),completion=useRef<{signature:string;key:string}|null>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{if(!photo){setPreview('');return;}const url=URL.createObjectURL(photo.blob);setPreview(url);return()=>URL.revokeObjectURL(url);},[photo?.blob]);
  const working=busy||upload.busy||preparing||(secure&&presence.busy);
  async function select(file:File|undefined){
    if(!file)return;setPreparing(true);setPhotoError('');
    try{const result=await preparePhoto(file);if(alive.current)setPhoto(result);}
    catch(e){if(alive.current)setPhotoError(e instanceof Error?e.message:'Не удалось подготовить фото.');}
    finally{if(alive.current)setPreparing(false);}
  }
  async function savePhoto(){
    if(!photo)return;
    if(await upload.run(`/api/orders/${order.id}/photo`,{expectedVersion:order.assignmentVersion??0,image:photo.base64})){setPhoto(current=>current?{...current,saved:true}:current);data.reload();}
  }
  async function complete(){
    const body={expectedVersion:order.assignmentVersion??0,handedOver:true,...(secure?{expectedRouteVersion:order.routeVersion??0,stage:pickup?'PICKUP':'DROPOFF',code}:order.codeRequired?{code}:{})};
    const signature=JSON.stringify(body);if(completion.current?.signature!==signature)completion.current={signature,key:crypto.randomUUID()};
    if(!await onComplete({...body,requestKey:completion.current.key}))data.reload();
  }
  const photoReady=!photoRequired||(data.trust?.photo?.state==='READY'&&(!photo||photo.saved));
  const codeReady=secure?/^\d{6}$/.test(code)&&!!data.trust?.handoff?.codeReady:!order.codeRequired||(/^\d{4}$/.test(code)&&(data.trust?.attemptsRemaining??0)>0);
  return <ApplicationScreen title={pickup?'Подтверждение забора':'Подтверждение вручения'} courier busy={working} onBack={onBack} actions={<Button className="wide" disabled={working||!data.trust||!!data.error||!photoReady||!codeReady||!handed||(secure&&!data.trust?.handoff?.ready)} onClick={()=>void complete()}>{busy?'Сохраняем…':pickup?'Подтвердить забор':'Завершить доставку'}</Button>}>
    <div className="screen-heading"><h1 tabIndex={-1}>{pickup?'Получите посылку':'Передайте посылку'}</h1><p>{secure?(pickup?order.pickupAddress:order.destinationAddress):`${orderNumber(order)} · Завершайте заказ только после вручения.`}</p></div>{!secure&&<RouteCard pickup={order.pickupAddress} destination={order.destinationAddress}/>}
    {secure&&data.trust?.handoff&&!data.trust.handoff.ready&&<Feedback title={data.trust.handoff.message} tone="warning">{data.trust.handoff.distanceM!==null&&<p>До точки {pickup?'забора':'вручения'}: {formatDistance(data.trust.handoff.distanceM)}.</p>}</Feedback>}
    {secure&&!data.trust?.handoff?.ready&&<div className="trust-section">{presence.online&&presence.status?.locationSharing&&presence.status.consentCurrent?<>
      <Button variant="secondary" disabled={working} onClick={()=>void presence.refreshLocation().then(()=>data.reload())}>{presence.busy?'Обновляем позицию…':'Обновить позицию'}</Button>
      {presence.geoError&&<Feedback title={presence.geoError} tone="error" role="alert"/>}
    </>:<CourierGpsStatus/>}</div>}
    {error&&<Feedback title={error} tone="error" role="alert"/>}{data.error&&<Feedback title={data.error} tone="error" role="alert" action={<Button variant="ghost" onClick={data.reload}>Обновить подтверждение</Button>}/>}
    {data.loading&&!data.trust&&<p role="status">Проверяем требования заказа…</p>}
    {photoRequired?<section className="trust-section"><h2>Фото вручения</h2><p className="muted">Снимок упаковки в месте передачи. Без лиц и личных данных.</p>
      {preview?<img className="trust-photo" src={preview} alt="Выбранное фото упаковки перед отправкой"/>:<div className="trust-photo-empty">{data.trust?.photo?.state==='READY'?'Фото уже сохранено. Можно оставить его или выбрать другое.':'Сделайте фото или выберите снимок с устройства'}</div>}
      <input className="sr-only" tabIndex={-1} aria-label="Снять фото вручения" ref={camera} type="file" accept="image/*" capture="environment" onChange={e=>{void select(e.target.files?.[0]);e.target.value='';}}/>
      <input className="sr-only" tabIndex={-1} aria-label="Выбрать фото вручения" ref={gallery} type="file" accept="image/jpeg,image/png,image/heic,image/heif" onChange={e=>{void select(e.target.files?.[0]);e.target.value='';}}/>
      <div className="trust-pair"><Button variant="secondary" disabled={working} onClick={()=>camera.current?.click()}>Сделать фото</Button><Button variant="secondary" disabled={working} onClick={()=>gallery.current?.click()}>Выбрать фото</Button></div>
      {preparing&&<p role="status">Подготавливаем фото…</p>}{photo&&!photo.saved&&<Button disabled={working} onClick={()=>void savePhoto()}>{upload.busy?'Сохраняем фото…':'Сохранить фото'}</Button>}
      {(photo?.saved||(!photo&&data.trust?.photo?.state==='READY'))&&<Feedback title="Фото сохранено" tone="success" role="status"/>}
      {(photoError||upload.error)&&<Feedback title={photoError||upload.error} tone="error" role="alert"/>}<p className="muted">JPEG, до 1 МБ и 1600 пикселей после сжатия. Доступ в Qadam — до 30 суток.</p>
    </section>:!secure&&<Feedback title="Фото для этого заказа не требуется">Заказ оформлен до подключения фото вручения. Его требования сохранены.</Feedback>}
    {(secure||order.codeRequired)&&<section className="trust-section"><h2>{pickup?'Код отправителя':'Код получателя'}</h2>{(secure?data.trust?.handoff?.attemptsRemaining:data.trust?.attemptsRemaining)===0?<Feedback title="Попытки закончились" tone="warning">Попросите отправителя выпустить новый код.</Feedback>:<><p className="muted">{pickup?'Попросите код, когда посылка у вас.':'Получатель назовёт код после передачи.'}</p>{secure&&!data.trust?.handoff?.codeReady&&<p className="field-hint">Отправителю нужно открыть код в своём заказе.</p>}<div className="field"><label htmlFor="delivery-code-input">{secure?'6 цифр':'4 цифры'}</label><input id="delivery-code-input" className="delivery-code-input" type="text" inputMode="numeric" autoComplete="off" pattern={secure?'[0-9]{6}':'[0-9]{4}'} maxLength={secure?6:4} value={code} disabled={working} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} aria-describedby="delivery-code-attempts"/><small id="delivery-code-attempts">Осталось попыток: {(secure?data.trust?.handoff?.attemptsRemaining:data.trust?.attemptsRemaining)??'…'}</small></div></>}</section>}
    <label className="courier-consent"><input type="checkbox" checked={handed} disabled={working} onChange={e=>setHanded(e.target.checked)}/><span>{pickup?'Посылка у меня':'Посылка передана получателю'}</span></label>
    <a className="handoff-support" href="https://t.me/zharlkssnv" target="_blank" rel="noopener noreferrer">Нужна помощь?</a>
  </ApplicationScreen>;
}

export function CourierRelease({order,onReleased}:{order:Order;onReleased:()=>void}){
  const [open,setOpen]=useState(false),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false);const action=useTrustAction();
  return <section className="trust-section">{!open?<Button variant="ghost" onClick={()=>setOpen(true)}>Отказаться до забора</Button>:<form className="trust-section" onSubmit={e=>{e.preventDefault();void action.run(`/api/orders/${order.id}/release`,{expectedVersion:order.assignmentVersion??0,reason:reason.trim(),notPickedUp:true}).then(result=>{if(result)onReleased();});}}>
    <h2>Вернуть заказ в поиск?</h2><p className="muted">Отправитель увидит причину. После забора посылки отказ оформляется через команду.</p>
    <div className="field"><label htmlFor="release-reason">Причина отказа</label><textarea id="release-reason" required minLength={5} maxLength={500} disabled={action.busy} value={reason} onChange={e=>setReason(e.target.value)}/></div>
    <label className="courier-consent"><input type="checkbox" required checked={confirmed} disabled={action.busy} onChange={e=>setConfirmed(e.target.checked)}/><span>Я ещё не забрал посылку</span></label>
    {action.error&&<Feedback title={action.error} tone="error" role="alert"/>}<Button type="submit" variant="danger" disabled={action.busy||!confirmed||reason.trim().length<5}>{action.busy?'Сохраняем…':'Вернуть в поиск'}</Button><Button variant="ghost" disabled={action.busy} onClick={()=>setOpen(false)}>Оставить заказ у себя</Button>
  </form>}</section>;
}
