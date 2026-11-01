import {database} from './db';

export async function expireOrderPhotos(){
  const db=database();
  const expired=await db.query("UPDATE qadam.order_photos SET state='EXPIRED',file_id=NULL WHERE expires_at<=clock_timestamp() AND file_id IS NOT NULL RETURNING id");
  await db.query("UPDATE qadam.telegram_outbox SET body='{}'::jsonb WHERE method='sendPhoto' AND created_at<=clock_timestamp()-interval '30 days' AND body<>'{}'::jsonb");
  return expired.rowCount??0;
}
