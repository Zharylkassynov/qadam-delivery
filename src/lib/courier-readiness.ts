import type {Db} from './telegram-outbox';
import {AppError} from './errors';
import {locationConsentVersion} from './location-consent';

// Only internal SQL aliases are accepted by callers. No request data enters SQL.
export const freshCourierPosition=(p='p',s='s')=>`(${p}.sharing AND ${p}.consent_at IS NOT NULL
  AND ${p}.auto_consent_version='${locationConsentVersion}' AND ${p}.auto_consent_at IS NOT NULL
  AND ${s}.online AND ${s}.updated_at>clock_timestamp()-interval '8 hours'
  AND ${p}.latitude IS NOT NULL AND ${p}.longitude IS NOT NULL
  AND ${p}.received_at>=${s}.updated_at AND ${p}.received_at>clock_timestamp()-interval '90 seconds'
  AND ${p}.captured_at>clock_timestamp()-interval '90 seconds' AND ${p}.captured_at<=clock_timestamp()+interval '30 seconds')`;

export async function requireReadyCourier(db:Db,id:string){
  const result=await db.query(`SELECT s.user_id FROM qadam.courier_status s
    JOIN qadam.courier_presence p ON p.user_id=s.user_id
    WHERE s.user_id=$1 AND s.accepting_orders AND ${freshCourierPosition()} FOR UPDATE OF s,p`,[id]);
  if(!result.rowCount)throw new AppError(409,'Чтобы принять новый заказ, выйдите на линию, подтвердите условия геопозиции и передайте свежую позицию.');
}
