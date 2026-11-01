'use client';

import {useEffect,useState} from 'react';
import {api} from '../lib/client-api';
import type {CourierApplication,Order,User} from '../lib/types';
import {transportLabels} from '../lib/types';
import {Button,Feedback,formatTime} from './delivery-ui';
import {useTrustAction} from './order-trust';

type Management={candidates:{id:string;name:string;transport:CourierApplication['transport']|null;phoneVerified:boolean|null}[];events:{id:string;kind:string;reason:string|null;actor:string;at:string}[]};
export function AdminDispatch({order,onSaved}:{order:Order;onSaved:()=>void}){
  const [data,setData]=useState<Management|null>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  const [mode,setMode]=useState<'ASSIGN'|'CANCEL'|null>(null),[courier,setCourier]=useState(''),[reason,setReason]=useState(''),[custody,setCustody]=useState(false),[notice,setNotice]=useState('');
  const [expected,setExpected]=useState({version:order.assignmentVersion??0,status:order.status,courier:order.courierId});
  const action=useTrustAction();
  useEffect(()=>{
    const controller=new AbortController();let alive=true;setError('');
    void api<Management>(`/api/admin/orders/${order.id}/manage`,undefined,controller.signal).then(value=>{if(alive)setData(value);}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'Не удалось загрузить управление заказом.');});
    return()=>{alive=false;controller.abort();};
  },[order.id,order.status,order.assignmentVersion,refresh]);
  const stale=expected.version!==(order.assignmentVersion??0)||expected.status!==order.status||expected.courier!==order.courierId;
  const active=!['DELIVERED','CANCELLED'].includes(order.status),picked=['PICKED_UP','IN_TRANSIT'].includes(order.status);
  function open(value:'ASSIGN'|'CANCEL'){setExpected({version:order.assignmentVersion??0,status:order.status,courier:order.courierId});setMode(value);setReason('');setCourier('');setCustody(false);setNotice('');action.setError('');}
  async function save(){
    const result=await action.run(`/api/admin/orders/${order.id}/manage`,{expectedVersion:expected.version,expectedStatus:expected.status,expectedCourierId:expected.courier,action:mode,reason:reason.trim(),custodyConfirmed:custody,...(mode==='ASSIGN'?{courierId:courier}:{})});
    if(result){setMode(null);setNotice('Действие сохранено. Участники получат доступные уведомления.');setRefresh(n=>n+1);onSaved();}
  }
  return <section className="trust-section admin-dispatch"><h2>Управление заказом</h2>{error&&<Feedback title={error} tone="error" role="alert" action={<Button variant="ghost" onClick={()=>setRefresh(n=>n+1)}>Повторить</Button>}/>}
    {notice&&<Feedback title={notice} tone="success" role="status"/>}
    {active&&!mode&&<div className="trust-section"><Button variant="secondary" disabled={!data||!!error} onClick={()=>open('ASSIGN')}>{order.courierId?'Сменить курьера':'Назначить курьера'}</Button><Button variant="ghost" onClick={()=>open('CANCEL')}>Отменить заказ</Button></div>}
    {active&&mode&&<form className="trust-section" onSubmit={e=>{e.preventDefault();void save();}}>
      <h3>{mode==='ASSIGN'?order.courierId?'Смена курьера':'Назначение курьера':'Отмена заказа'}</h3>
      {stale&&<Feedback title="Заказ уже изменился" tone="warning">Проверьте актуальный статус и заново выберите действие.<Button variant="secondary" onClick={()=>{setMode(null);onSaved();}}>Обновить сведения</Button></Feedback>}
      {mode==='ASSIGN'&&(data?.candidates.length?<div className="field"><label htmlFor="dispatch-courier">Курьер</label><select id="dispatch-courier" value={courier} required disabled={action.busy||stale} onChange={e=>setCourier(e.target.value)}><option value="">Выберите исполнителя</option>{data.candidates.map(c=><option key={c.id} value={c.id}>{c.name}{c.transport?` · ${transportLabels[c.transport]}`:''}</option>)}</select><small>Только действующие курьеры без несовместимой активной доставки. Для автотарифа нужен автомобиль и подтверждённый телефон.</small></div>:<Feedback title="Нет подходящих курьеров" tone="warning">Проверьте заявки, ограничения доступа и активные доставки.</Feedback>)}
      <div className="field"><label htmlFor="dispatch-reason">Причина действия</label><textarea id="dispatch-reason" minLength={5} maxLength={500} required disabled={action.busy||stale} value={reason} onChange={e=>setReason(e.target.value)}/><small>Причина видна участникам заказа. Не добавляйте лишние персональные сведения.</small></div>
      {picked&&<><Feedback title="Посылка уже у курьера" tone="warning">Сначала согласуйте передачу новому курьеру или возврат. Смена в приложении сама по себе не передаёт посылку.</Feedback><label className="courier-consent"><input type="checkbox" required checked={custody} disabled={action.busy||stale} onChange={e=>setCustody(e.target.checked)}/><span>Передача или возврат посылки согласованы</span></label></>}
      {mode==='CANCEL'&&<p className="muted">Отмена не возвращает наличные и переводы Kaspi. Расчёты согласуются отдельно.</p>}
      {action.error&&<Feedback title={action.error} tone="error" role="alert"/>}
      <Button type="submit" variant={mode==='CANCEL'?'danger':'primary'} disabled={action.busy||stale||reason.trim().length<5||(picked&&!custody)||(mode==='ASSIGN'&&(!courier||!data||!!error))}>{action.busy?'Сохраняем…':mode==='CANCEL'?'Подтвердить отмену':'Подтвердить назначение'}</Button><Button variant="ghost" disabled={action.busy} onClick={()=>setMode(null)}>Не менять заказ</Button>
    </form>}
    {!active&&<p className="muted">Завершённый заказ изменить нельзя.</p>}
    {data&&<details className="trust-audit"><summary>Журнал действий команды</summary>{data.events.filter(event=>event.kind!=='STATUS').length?data.events.filter(event=>event.kind!=='STATUS').map(event=><div key={event.id}><strong>{{ASSIGN:'Назначение курьера',RELEASE:'Отказ до забора',CANCEL:'Отмена заказа',CODE_RESET:'Перевыпуск кода'}[event.kind]??event.kind}</strong><p className="pre-wrap">{event.reason}</p><small>{event.actor} · {formatTime(event.at)}</small></div>):<p className="muted">Действий пока нет.</p>}</details>}
  </section>;
}

export function CourierBlockControl({courier,user,onSaved}:{courier:CourierApplication;user:User;onSaved:()=>void}){
  const [open,setOpen]=useState(false),[reason,setReason]=useState('');const action=useTrustAction();
  if(courier.userId===user.id)return <p className="muted">Ваш курьерский доступ изменяет другой администратор.</p>;
  return <div className="trust-section">{!open?<Button variant="secondary" onClick={()=>setOpen(true)}>{courier.blocked?'Открыть курьерский доступ':'Ограничить курьерский доступ'}</Button>:<form className="trust-section" onSubmit={e=>{e.preventDefault();void action.run(`/api/admin/couriers/${courier.userId}/block`,{expectedBlocked:!!courier.blocked,blocked:!courier.blocked,reason:reason.trim()}).then(result=>{if(result){setOpen(false);onSaved();}});}}>
    <h3>{courier.blocked?'Открыть доступ?':'Ограничить доступ?'}</h3><p className="muted">{courier.blocked?'Курьер сможет снова работать с заказами. Выход на линию он включает сам.':'Курьерские операции и передача геопозиции прекратятся. Уже принятые посылки нужно разобрать во «Всех заказах» отдельно.'}</p>
    <div className="field"><label htmlFor={`block-reason-${courier.id}`}>Причина решения</label><textarea id={`block-reason-${courier.id}`} required minLength={5} maxLength={500} disabled={action.busy} value={reason} onChange={e=>setReason(e.target.value)}/></div>
    {action.error&&<Feedback title={action.error} tone="error" role="alert" action={<Button variant="ghost" onClick={onSaved}>Обновить список</Button>}/>}
    <Button type="submit" variant={courier.blocked?'primary':'danger'} disabled={action.busy||reason.trim().length<5}>{action.busy?'Сохраняем…':courier.blocked?'Открыть доступ':'Ограничить доступ'}</Button><Button variant="ghost" disabled={action.busy} onClick={()=>setOpen(false)}>Не менять доступ</Button>
  </form>}</div>;
}
