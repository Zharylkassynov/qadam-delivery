import { z } from 'zod';
import type { PoolClient } from 'pg';
import { database,transaction } from './db';
import { AppError } from './errors';
import { requirePhone } from './user-profiles';
import type { MapPoint,User } from './types';

export type BusinessProfile={name:string;pickupAddress:string;pickupPoint:MapPoint;pickupDetails:string;updatedAt:string};
export const businessProfileSchema=z.object({
  name:z.string().trim().min(2).max(100),pickupAddress:z.string().trim().min(5).max(300),
  pickupPoint:z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180)}).strict(),
  pickupDetails:z.string().trim().max(200).default(''),
}).strict();
function customer(actor:User){if(actor.role!=='CUSTOMER')throw new AppError(403,'Профиль магазина доступен клиенту.');}
export async function businessProfile(actor:User):Promise<BusinessProfile|null>{
  customer(actor);
  return (await database().query(`SELECT name,pickup_address AS "pickupAddress",pickup_details AS "pickupDetails",updated_at AS "updatedAt",
    jsonb_build_object('latitude',pickup_latitude,'longitude',pickup_longitude) AS "pickupPoint"
    FROM qadam.business_profiles WHERE user_id=$1`,[actor.id])).rows[0]??null;
}
export async function saveBusinessProfile(actor:User,input:unknown){
  customer(actor);const data=businessProfileSchema.parse(input);
  await transaction(async db=>{
    await requirePhone(actor,db);
    await db.query(`INSERT INTO qadam.business_profiles(user_id,name,pickup_address,pickup_latitude,pickup_longitude,pickup_details)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,pickup_address=excluded.pickup_address,
      pickup_latitude=excluded.pickup_latitude,pickup_longitude=excluded.pickup_longitude,pickup_details=excluded.pickup_details,updated_at=clock_timestamp()`,
    [actor.id,data.name,data.pickupAddress,data.pickupPoint.latitude,data.pickupPoint.longitude,data.pickupDetails]);
  });
  return businessProfile(actor);
}
export async function deleteBusinessProfile(actor:User){customer(actor);await database().query('DELETE FROM qadam.business_profiles WHERE user_id=$1',[actor.id]);}
export async function checkBusinessSnapshot(actor:User,name:string|null|undefined,db:Pick<PoolClient,'query'>=database()){
  if(!name)return;
  const result=await db.query('SELECT name FROM qadam.business_profiles WHERE user_id=$1 FOR SHARE',[actor.id]);
  if(result.rows[0]?.name!==name)throw new AppError(409,'Профиль магазина изменился. Обновите его или выберите «С другого адреса».');
}
