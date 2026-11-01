import { z } from 'zod';
import { database, transaction } from './db';
import { AppError } from './errors';
import type { User } from './types';
import type { CourierLocation } from './types';
import type { Db } from './telegram-outbox';
import {lockCouriers,requireCourierAccess,notBlocked} from './trust-core';
import {locationConsentVersion} from './location-consent';

export const courierStatusSchema = z.object({ online: z.boolean() }).strict();
export type CourierStatus = { online: boolean; expired: boolean; updatedAt: string | null; expiresAt: string | null; allowsWrite: boolean; hasTelegram: boolean;
  locationSharing:boolean; locationConsentAt:string|null; location:CourierLocation|null; autoLocationEnabled?:boolean };

async function readStatus(db: Db, actor: User): Promise<CourierStatus> {
  const row = (await db.query(`SELECT s.updated_at AS "updatedAt",s.updated_at+interval '8 hours' AS "expiresAt",
    coalesce(s.online AND s.updated_at>now()-interval '8 hours',false) AS online,
    coalesce(s.online AND s.updated_at<=now()-interval '8 hours',false) AS expired,
    t.telegram_user_id IS NOT NULL AS "hasTelegram",coalesce(t.allows_write AND t.bot_blocked_at IS NULL,false) AS "allowsWrite"
    ,coalesce(p.sharing,false) AS "locationSharing",p.consent_at AS "locationConsentAt",
    coalesce(p.auto_location_enabled AND p.auto_consent_version=$2,false) AS "autoLocationEnabled",
    CASE WHEN p.latitude IS NOT NULL THEN jsonb_build_object('latitude',p.latitude,'longitude',p.longitude,'accuracy',p.accuracy,'capturedAt',p.captured_at,'receivedAt',p.received_at) END AS location
    FROM qadam.users u LEFT JOIN qadam.courier_status s ON s.user_id=u.id
    LEFT JOIN qadam.telegram_identities t ON t.user_id=u.id
    LEFT JOIN qadam.courier_presence p ON p.user_id=u.id
    WHERE u.id=$1 AND u.active AND ${notBlocked()} AND (u.role='COURIER' OR EXISTS
      (SELECT 1 FROM qadam.courier_applications a WHERE a.user_id=u.id AND a.status='APPROVED'))`, [actor.id,locationConsentVersion])).rows[0];
  if (!row) throw new AppError(403, 'Режим доступен только одобренному курьеру.');
  return { online: row.online, expired: row.expired, updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null, allowsWrite: row.allowsWrite, hasTelegram: row.hasTelegram,
    locationSharing:row.locationSharing,autoLocationEnabled:row.autoLocationEnabled,locationConsentAt:row.locationConsentAt?new Date(row.locationConsentAt).toISOString():null,location:row.location };
}
export const getCourierStatus = (actor: User) => readStatus(database(), actor);
export async function setCourierStatus(actor: User, input: unknown) {
  const data = courierStatusSchema.parse(input);
  return transaction(async db => {
    await lockCouriers(db,[actor.id]);await requireCourierAccess(db,actor.id);
    await readStatus(db, actor);
    await db.query(`INSERT INTO qadam.courier_status(user_id,online) VALUES($1,$2)
      ON CONFLICT(user_id) DO UPDATE SET online=excluded.online,updated_at=now()`, [actor.id, data.online]);
    if(data.online){await db.query(`UPDATE qadam.courier_presence SET sharing=true,consent_at=coalesce(consent_at,clock_timestamp())
      WHERE user_id=$1 AND auto_location_enabled AND auto_consent_version=$2`,[actor.id,locationConsentVersion]);}
    else await db.query('UPDATE qadam.courier_presence SET sharing=false,latitude=NULL,longitude=NULL,accuracy=NULL,captured_at=NULL,received_at=NULL WHERE user_id=$1',[actor.id]);
    return readStatus(db, actor);
  });
}
