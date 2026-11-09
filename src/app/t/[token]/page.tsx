import type {Metadata} from 'next';
import {RecipientTracking} from '../../../components/recipient-tracking';
export const metadata:Metadata={title:'Ваша доставка — Qadam',description:'Статус доставки Qadam.',robots:{index:false,follow:false,noarchive:true},referrer:'no-referrer'};
export const dynamic='force-dynamic';
export default async function TrackingPage({params}:{params:Promise<{token:string}>}){
  const {token}=await params;
  return <RecipientTracking token={/^[A-Za-z0-9_-]{43}$/.test(token)?token:''}/>;
}
