import {createHash,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {database,transaction} from './db';
import {AppError} from './errors';
import {appOrigin} from './deployment-config';
import {locationConsentVersion} from './location-consent';
import {notBlocked,requireCourierAccess,parseTrust} from './trust-core';
import {recipientConsentVersion,type RecipientDelivery,type RecipientLink} from './recipient-tracking-types';
import type {User} from './types';

const unavailable=()=>new AppError(404,'Ссылка недоступна. Попросите отправителя прислать новую ссылку.');
const tokenValid=(token:string)=>/^[A-Za-z0-9_-]{43}$/.test(token);
// Event time is immutable; changing a note must not extend a completed link.
const deadline=`LEAST(o.tracking_expires_at,COALESCE(
  (SELECT min(e.created_at)+interval '24 hours' FROM qadam.order_events e
   WHERE e.order_id=o.id AND e.status IN ('DELIVERED','CANCELLED')),'infinity'::timestamptz))`;
const active=`o.tracking_token IS NOT NULL AND o.tracking_revoked_at IS NULL AND ${deadline}>clock_timestamp()`;

export async function recipientLink(actor:User,id:string,action:'read'|'create'|'revoke'='read'):Promise<RecipientLink>{
  if(!z.uuid().safeParse(id).success)throw new AppError(404,'Заказ недоступен.');
  return transaction(async db=>{
    const row=(await db.query(`SELECT o.id,o.tracking_token AS token,${deadline} AS expiry,${active} AS active,
      (SELECT min(e.created_at) FROM qadam.order_events e WHERE e.order_id=o.id AND e.status IN ('DELIVERED','CANCELLED')) AS finished
      FROM qadam.orders o JOIN qadam.users u ON u.id=o.customer_id AND u.active
      WHERE o.id=$1 AND o.customer_id=$2 FOR UPDATE OF o`,[id,actor.id])).rows[0];
    if(!row)throw new AppError(404,'Заказ недоступен.');
    if(action==='revoke'){
      await db.query('UPDATE qadam.orders SET tracking_revoked_at=clock_timestamp() WHERE id=$1',[id]);
      return{url:null,expiresAt:null};
    }
    if(action==='create'&&!row.active){
      if(row.finished&&Date.now()-new Date(row.finished).getTime()>=86400000)throw new AppError(409,'Срок отслеживания завершён.');
      const saved=(await db.query(`WITH stamp AS (SELECT clock_timestamp() AS at)
        UPDATE qadam.orders SET tracking_token=$2,tracking_issued_at=stamp.at,
        tracking_expires_at=stamp.at+interval '7 days',tracking_revoked_at=NULL FROM stamp WHERE id=$1
        RETURNING tracking_token AS token`,[id,randomBytes(32).toString('base64url')])).rows[0];
      const expiry=(await db.query(`SELECT ${deadline} AS expiry FROM qadam.orders o WHERE o.id=$1`,[id])).rows[0].expiry;
      return{url:`${appOrigin()}/t/${saved.token}`,expiresAt:new Date(expiry).toISOString()};
    }
    return row.active?{url:`${appOrigin()}/t/${row.token}`,expiresAt:new Date(row.expiry).toISOString()}:{url:null,expiresAt:null};
  });
}

export async function recipientPreference(actor:User,input?:unknown){
  await requireCourierAccess(database(),actor.id);
  if(input!==undefined){
    const data=parseTrust(z.union([z.object({enabled:z.literal(true),consentVersion:z.literal(recipientConsentVersion)}).strict(),z.object({enabled:z.literal(false)}).strict()]),input);
    await database().query(`INSERT INTO qadam.recipient_location_preferences(user_id,enabled,consent_version,consented_at,revoked_at)
      VALUES($1,$2,$3,CASE WHEN $2 THEN clock_timestamp() END,CASE WHEN NOT $2 THEN clock_timestamp() END)
      ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,
      consent_version=CASE WHEN excluded.enabled THEN excluded.consent_version ELSE qadam.recipient_location_preferences.consent_version END,
      consented_at=CASE WHEN excluded.enabled THEN excluded.consented_at ELSE qadam.recipient_location_preferences.consented_at END,
      revoked_at=excluded.revoked_at`,[actor.id,data.enabled,data.enabled?recipientConsentVersion:null]);
  }
  const row=(await database().query('SELECT enabled,consent_version FROM qadam.recipient_location_preferences WHERE user_id=$1',[actor.id])).rows[0];
  return{enabled:!!row?.enabled&&row.consent_version===recipientConsentVersion};
}

// Shared, bounded counters also protect invalid secrets. No raw IP/token stored.
export async function takeRecipientBudget(request:Request,token:string,tiles=false){
  // Only Vercel's overwritten header is trusted; other deployments share the
  // conservative anonymous bucket until a trusted reverse proxy is configured.
  const address=process.env.VERCEL==='1'?(request.headers.get('x-vercel-forwarded-for')??'anonymous'):'anonymous';
  const hash=(s:string)=>createHash('sha256').update(s).digest('hex').slice(0,24);
  const blocked=await transaction(async db=>{
    const now=Date.now(),period=Math.floor(now/60000),day=Math.floor(now/86400000);
    const prefix=tiles?'recipient-tile':'recipient';
    const limits:[string,number,number][]=[
      [`${prefix}:global:${period}`,tiles?600:600,120],
      [`${prefix}:actor:${hash(address)}:${period}`,tiles?300:300,120],
      [`${prefix}:token:${hash(token)}:${period}`,tiles?240:60,120],
      [`${prefix}:day:${day}`,tiles?6000:20000,86400],
    ];
    let limited=false;
    await db.query('DELETE FROM qadam.service_limits WHERE bucket IN (SELECT bucket FROM qadam.service_limits WHERE expires_at<clock_timestamp() LIMIT 100)');
    // Same order for concurrent requests; reject after commit so abuse counts.
    for(const [bucket,max,seconds]of limits){
      const r=await db.query(`INSERT INTO qadam.service_limits(bucket,hits,expires_at) VALUES($1,1,clock_timestamp()+$2*interval '1 second')
        ON CONFLICT(bucket) DO UPDATE SET hits=LEAST(qadam.service_limits.hits+1,1000000) RETURNING hits`,[bucket,seconds]);
      limited ||= r.rows[0].hits>max;
    }
    return limited;
  });
  if(blocked)throw new AppError(429,'Слишком много запросов. Подождите минуту и повторите.');
}

export async function publicRecipientDelivery(token:string):Promise<RecipientDelivery>{
  if(!tokenValid(token))throw unavailable();
  // Deliberately not selectOrder: no private order fields may reach HTML/JSON.
  const row=(await database().query(`SELECT o.status,CASE WHEN NOT o.surprise THEN o.business_name END AS "businessName",
    o.deliver_after AS "deliverAfter",o.deliver_before AS "deliverBefore",${deadline} AS "expiresAt",
    clock_timestamp() AS "checkedAt",
    CASE WHEN pref.enabled AND pref.consent_version=$2 AND u.active AND ${notBlocked()}
      AND (u.role='COURIER' OR EXISTS(SELECT 1 FROM qadam.courier_applications a WHERE a.user_id=u.id AND a.status='APPROVED'))
      THEN split_part(trim(u.name),' ',1) END AS "courierName",
    l.latitude,l.longitude,l.accuracy,l.captured_at AS "capturedAt",l.received_at AS "receivedAt",l.location_source AS source,
    EXISTS(SELECT 1 FROM qadam.courier_status s JOIN qadam.courier_presence p ON p.user_id=s.user_id
      WHERE s.user_id=o.courier_id AND s.online AND s.updated_at>clock_timestamp()-interval '8 hours'
      AND p.sharing AND p.auto_consent_version=$3) AS sharing
    FROM qadam.orders o JOIN qadam.users customer ON customer.id=o.customer_id AND customer.active
    LEFT JOIN qadam.users u ON u.id=o.courier_id
    LEFT JOIN qadam.recipient_location_preferences pref ON pref.user_id=o.courier_id
    LEFT JOIN qadam.courier_locations l ON l.order_id=o.id AND l.courier_id=o.courier_id
    WHERE o.tracking_token=$1 AND ${active}`,[token,recipientConsentVersion,locationConsentVersion])).rows[0];
  if(!row)throw unavailable();
  const toDate=(value:Date|string|null)=>value?new Date(value).toISOString():null;
  const eligible=['PICKED_UP','IN_TRANSIT'].includes(row.status)&&!!row.courierName&&row.sharing;
  const captured=toDate(row.capturedAt),received=toDate(row.receivedAt),now=new Date(row.checkedAt).getTime();
  const fresh=eligible&&captured&&received&&now-Date.parse(captured)<=90000&&now-Date.parse(received)<=90000&&Date.parse(captured)<=now+30000&&Date.parse(received)<=now+30000;
  return{status:row.status,businessName:row.businessName??null,deliverAfter:toDate(row.deliverAfter),deliverBefore:toDate(row.deliverBefore),
    courierName:['DELIVERED','CANCELLED'].includes(row.status)?null:row.courierName??null,
    location:fresh?{latitude:row.latitude,longitude:row.longitude,accuracy:row.accuracy,capturedAt:captured!,receivedAt:received!,source:row.source}:null,
    lastMeasuredAt:eligible?captured:null,checkedAt:toDate(row.checkedAt)!,expiresAt:toDate(row.expiresAt)!,mapAvailable:!!process.env.GEOAPIFY_API_KEY};
}
