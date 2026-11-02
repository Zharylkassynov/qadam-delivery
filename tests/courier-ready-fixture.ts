import {database} from '../src/lib/db';
import {locationConsentVersion} from '../src/lib/location-consent';
import type {User} from '../src/lib/types';

// Existing business-flow suites start with a courier whose shift and GPS were
// already established. GPS permission/readiness itself is tested separately.
export async function readyCourier(user:User){
  if(!process.env.DATABASE_URL||!new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))throw new Error('Test database required');
  await database().query(`INSERT INTO qadam.courier_status(user_id,online,accepting_orders,updated_at)
    VALUES($1,true,true,clock_timestamp()-interval '10 seconds') ON CONFLICT(user_id) DO UPDATE
    SET online=true,accepting_orders=true,updated_at=excluded.updated_at`,[user.id]);
  await database().query(`INSERT INTO qadam.courier_presence(user_id,sharing,consent_at,auto_location_enabled,auto_consent_version,auto_consent_at,latitude,longitude,accuracy,captured_at,received_at)
    VALUES($1,true,clock_timestamp()-interval '10 seconds',true,$2,clock_timestamp()-interval '10 seconds',43.24,76.9,25,$3,clock_timestamp()-interval '6 seconds')
    ON CONFLICT(user_id) DO UPDATE SET sharing=true,consent_at=excluded.consent_at,auto_location_enabled=true,auto_consent_version=excluded.auto_consent_version,
      auto_consent_at=excluded.auto_consent_at,latitude=excluded.latitude,longitude=excluded.longitude,accuracy=excluded.accuracy,captured_at=excluded.captured_at,received_at=excluded.received_at`,[user.id,locationConsentVersion,new Date(Date.now()-6000).toISOString()]);
}
