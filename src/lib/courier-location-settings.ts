import {z} from 'zod';
import {transaction} from './db';
import {lockCouriers,requireCourierAccess,parseTrust} from './trust-core';
import {locationConsentVersion} from './location-consent';
import type {User} from './types';
const schema=z.union([
  z.object({autoEnabled:z.literal(true),consentVersion:z.literal(locationConsentVersion)}).strict(),
  z.object({autoEnabled:z.literal(false)}).strict(),
  z.object({revoke:z.literal(true)}).strict(),
]);
export async function saveLocationSettings(actor:User,input:unknown){
  const data=parseTrust(schema,input);
  return transaction(async db=>{
    await lockCouriers(db,[actor.id]);await requireCourierAccess(db,actor.id);
    if('revoke' in data){
      await db.query("SELECT id FROM qadam.orders WHERE courier_id=$1 AND status IN ('ACCEPTED','PICKED_UP','IN_TRANSIT') ORDER BY id FOR UPDATE",[actor.id]);
      await db.query(`UPDATE qadam.courier_presence SET auto_location_enabled=false,auto_consent_version=NULL,
        sharing=false,latitude=NULL,longitude=NULL,accuracy=NULL,captured_at=NULL,received_at=NULL WHERE user_id=$1`,[actor.id]);
      await db.query("UPDATE qadam.order_location_streams SET state='STOPPED',stopped_at=clock_timestamp() WHERE courier_id=$1 AND state IN ('WAITING','LIVE')",[actor.id]);
      await db.query(`UPDATE qadam.courier_status SET accepting_orders=false,
        end_after_delivery=online AND EXISTS(SELECT 1 FROM qadam.orders WHERE courier_id=$1 AND status IN ('ACCEPTED','PICKED_UP','IN_TRANSIT')),
        online=online AND EXISTS(SELECT 1 FROM qadam.orders WHERE courier_id=$1 AND status IN ('ACCEPTED','PICKED_UP','IN_TRANSIT')) WHERE user_id=$1`,[actor.id]);
    }else{
      await db.query(`INSERT INTO qadam.courier_presence(user_id,auto_location_enabled,auto_consent_version,auto_consent_at)
        VALUES($1,$2,$3,CASE WHEN $2 THEN clock_timestamp() END)
        ON CONFLICT(user_id) DO UPDATE SET auto_location_enabled=excluded.auto_location_enabled,
        auto_consent_version=CASE WHEN excluded.auto_location_enabled THEN excluded.auto_consent_version ELSE qadam.courier_presence.auto_consent_version END,
        auto_consent_at=CASE WHEN excluded.auto_location_enabled THEN excluded.auto_consent_at ELSE qadam.courier_presence.auto_consent_at END`,[actor.id,data.autoEnabled,data.autoEnabled?locationConsentVersion:null]);
    }
    return{ok:true};
  });
}
