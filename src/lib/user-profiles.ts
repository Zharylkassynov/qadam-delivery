import type { PoolClient } from 'pg';
import { database } from './db';
import { AppError } from './errors';
import type { User } from './types';

export type PhoneProfile = { phone: string | null; phoneVerified: boolean; verifiedAt: string | null };
export async function phoneProfile(actor: User, db: Pick<PoolClient,'query'> = database()): Promise<PhoneProfile> {
  const row=(await db.query('SELECT phone,phone_verified AS "phoneVerified",verified_at AS "verifiedAt" FROM qadam.user_profiles WHERE user_id=$1',[actor.id])).rows[0];
  return row??{phone:null,phoneVerified:false,verifiedAt:null};
}
// Called only from a private, authenticated Telegram webhook contact whose user_id
// equals message.from.id and chat.id. No browser mutation can write this profile.
export async function saveTelegramContact(telegramId: string, rawPhone: string, updateId:number) {
  const phone='+'+rawPhone.replace(/\D/g,'');
  if(!/^\+[1-9]\d{6,14}$/.test(phone))return;
  await database().query(`INSERT INTO qadam.user_profiles(user_id,phone,last_telegram_update_id)
    SELECT user_id,$2,$3 FROM qadam.telegram_identities WHERE telegram_user_id=$1
    ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,phone_verified=true,
      verified_at=now(),updated_at=now(),last_telegram_update_id=excluded.last_telegram_update_id
      WHERE excluded.last_telegram_update_id>qadam.user_profiles.last_telegram_update_id`,[telegramId,phone,updateId]);
}
export async function requirePhone(actor: User, db: Pick<PoolClient,'query'>) {
  const profile=await phoneProfile(actor,db);
  if(!profile.phoneVerified||!profile.phone)throw new AppError(409,'Подтвердите свой телефон через Telegram перед продолжением.');
  return profile.phone;
}
