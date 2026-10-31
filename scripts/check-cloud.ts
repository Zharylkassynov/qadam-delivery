import { assertCloudConfig } from './cloud-config';
import { database, closeDatabase } from '../src/lib/db';
import { TLSSocket } from 'node:tls';

try {
  const target = assertCloudConfig();
  const client = await database().connect();
  try {
  const stream = client.connection.stream;
  if (!(stream instanceof TLSSocket) || !stream.encrypted || !stream.authorized) throw new Error('Verified client TLS is required');
  // pg_stat_ssl reports the pooler-to-database hop, not our TLS socket.
  const result = await client.query(`SELECT current_database() AS database,current_user AS role,
    (SELECT count(*)::int FROM qadam.users) AS users,
    (SELECT count(*)::int FROM qadam.orders) AS orders,
    has_schema_privilege(current_user,'qadam','CREATE') AS can_create,
    has_table_privilege(current_user,'qadam.users','UPDATE') AS can_change_users`);
  const state = result.rows[0];
  if (state.role !== 'qadam_app' || state.can_create || state.can_change_users) throw new Error('Unexpected runtime permissions');
  const pricingState=(await client.query(`SELECT active AS "automaticPricingEnabled",
    has_table_privilege(current_user,'qadam.pricing_settings','INSERT,UPDATE,DELETE') AS "canChangeTariff"
    FROM qadam.pricing_settings WHERE singleton`)).rows[0];
  if(!pricingState||pricingState.canChangeTariff)throw new Error('Unexpected tariff permissions');
  // Exercise production permissions without reading personal data or changing rows.
  await client.query('BEGIN');
  try {
    await client.query('SELECT user_id,online,updated_at FROM qadam.courier_status LIMIT 0');
    await client.query('SELECT id,message_id,closed_at FROM qadam.order_notifications LIMIT 0');
    await client.query('UPDATE qadam.courier_status SET online=online WHERE false');
    await client.query('UPDATE qadam.order_notifications SET message_id=message_id,closed_at=closed_at WHERE false');
    await client.query('UPDATE qadam.orders SET alerted_at=alerted_at WHERE false');
    await client.query('SELECT user_id,sharing,consent_at,latitude,longitude,captured_at,received_at FROM qadam.courier_presence LIMIT 0');
    await client.query('UPDATE qadam.courier_presence SET sharing=sharing,latitude=latitude,received_at=received_at WHERE false');
    await client.query('SELECT user_id,phone,phone_verified,verified_at,last_telegram_update_id FROM qadam.user_profiles LIMIT 0');
    await client.query("INSERT INTO qadam.user_profiles(user_id,phone) SELECT gen_random_uuid(),'+77000000000' WHERE false");
    await client.query('UPDATE qadam.user_profiles SET phone=phone,verified_at=verified_at,last_telegram_update_id=last_telegram_update_id,updated_at=updated_at WHERE false');
    await client.query('SELECT id,owner_id,input_hash,price_kzt,breakdown,used_at FROM qadam.order_quotes LIMIT 0');
    await client.query(`INSERT INTO qadam.order_quotes(owner_id,input_hash,tariff_version,price_kzt,breakdown,distance_m,duration_s,provider,expires_at)
      SELECT gen_random_uuid(),repeat('0',64),'permissions-check',0,'{}'::jsonb,1,1,'TOMTOM_V1',now()+interval '1 minute' WHERE false`);
    await client.query('UPDATE qadam.order_quotes SET used_at=used_at WHERE false');
    await client.query('DELETE FROM qadam.order_quotes WHERE false');
    await client.query('SELECT quote_id,price_kzt,courier_payout_kzt,platform_fee_kzt,distance_m,duration_s,tariff_version,pricing_details,price_source,traffic_source,payer,payment_method,sender_phone,courier_phone FROM qadam.orders LIMIT 0');
    await client.query('UPDATE qadam.orders SET quote_id=quote_id,price_kzt=price_kzt,courier_payout_kzt=courier_payout_kzt,platform_fee_kzt=platform_fee_kzt,distance_m=distance_m,duration_s=duration_s,tariff_version=tariff_version,pricing_details=pricing_details,price_source=price_source,traffic_source=traffic_source,payer=payer,payment_method=payment_method,sender_phone=sender_phone,courier_phone=courier_phone WHERE false');
    await client.query('SELECT user_id,name,pickup_address,pickup_latitude,pickup_longitude,pickup_details,updated_at FROM qadam.business_profiles LIMIT 0');
    await client.query("INSERT INTO qadam.business_profiles(user_id,name,pickup_address,pickup_latitude,pickup_longitude) SELECT gen_random_uuid(),'permissions-check','permissions-check',43.24,76.9 WHERE false");
    await client.query('UPDATE qadam.business_profiles SET name=name,pickup_address=pickup_address,pickup_latitude=pickup_latitude,pickup_longitude=pickup_longitude,pickup_details=pickup_details,updated_at=updated_at WHERE false');
    await client.query('DELETE FROM qadam.business_profiles WHERE false');
    await client.query('SELECT parcel_type,fragile,surprise,urgent,card_text,business_name,pickup_details,deliver_after,deliver_before FROM qadam.orders LIMIT 0');
    await client.query('UPDATE qadam.orders SET parcel_type=parcel_type,fragile=fragile,surprise=surprise,urgent=urgent,card_text=card_text,business_name=business_name,pickup_details=pickup_details,deliver_after=deliver_after,deliver_before=deliver_before WHERE false');
  } finally { await client.query('ROLLBACK'); }
  console.log(JSON.stringify({ project: target.ref, host: target.host, poolerMode: target.poolerMode, clientTlsVerified: stream.authorized, tlsProtocol: stream.getProtocol(), orderNotificationsReady: true, courierPresenceReady:true, pricingContactsReady:true,businessOrdersReady:true, ...pricingState, ...state }));
  } finally { client.release(); }
} catch (error) {
  // Deliberately omit stack/URL, which may contain secrets from parser errors.
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'configuration';
  console.error(`Cloud database check failed (${code}). Check .env.supabase and the project status.`);
  process.exitCode = 1;
} finally { await closeDatabase(); }
