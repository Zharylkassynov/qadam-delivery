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
  // Exercise production permissions without reading personal data or changing rows.
  await client.query('BEGIN');
  try {
    await client.query('SELECT user_id,online,updated_at FROM qadam.courier_status LIMIT 0');
    await client.query('SELECT id,message_id,closed_at FROM qadam.order_notifications LIMIT 0');
    await client.query('UPDATE qadam.courier_status SET online=online WHERE false');
    await client.query('UPDATE qadam.order_notifications SET message_id=message_id,closed_at=closed_at WHERE false');
    await client.query('UPDATE qadam.orders SET alerted_at=alerted_at WHERE false');
  } finally { await client.query('ROLLBACK'); }
  console.log(JSON.stringify({ project: target.ref, host: target.host, poolerMode: target.poolerMode, clientTlsVerified: stream.authorized, tlsProtocol: stream.getProtocol(), orderNotificationsReady: true, ...state }));
  } finally { client.release(); }
} catch (error) {
  // Deliberately omit stack/URL, which may contain secrets from parser errors.
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'configuration';
  console.error(`Cloud database check failed (${code}). Check .env.supabase and the project status.`);
  process.exitCode = 1;
} finally { await closeDatabase(); }
