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
  console.log(JSON.stringify({ project: target.ref, host: target.host, poolerMode: target.poolerMode, clientTlsVerified: stream.authorized, tlsProtocol: stream.getProtocol(), ...state }));
  } finally { client.release(); }
} catch (error) {
  // Deliberately omit stack/URL, which may contain secrets from parser errors.
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'configuration';
  console.error(`Cloud database check failed (${code}). Check .env.supabase and the project status.`);
  process.exitCode = 1;
} finally { await closeDatabase(); }
