import { readFileSync } from 'node:fs';
import type { PoolConfig } from 'pg';

export function databaseConfig(connectionString: string, env: Record<string, string | undefined> = process.env): PoolConfig {
  let url: URL;
  try { url = new URL(connectionString); } catch { throw new Error('Invalid DATABASE_URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use PostgreSQL');
  const docker = env.QADAM_LOCAL_DOCKER === 'true';
  if (env.QADAM_LOCAL_DOCKER && !['true', 'false'].includes(env.QADAM_LOCAL_DOCKER)) {
    throw new Error('QADAM_LOCAL_DOCKER must be true or false');
  }
  // The non-TLS exception is limited to the private, local Compose database.
  // It cannot be used to weaken TLS for cloud hosts or any Vercel deployment.
  if (docker && (env.VERCEL === '1' || url.hostname !== 'db' || url.port !== '5432' || url.search)) {
    throw new Error('Local Docker PostgreSQL must use db:5432 without URL options, outside Vercel');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || docker;
  const max = Number(env.DATABASE_POOL_MAX ?? (local ? '5' : '3'));
  if (!Number.isInteger(max) || max < 1 || max > 10) throw new Error('DATABASE_POOL_MAX must be between 1 and 10');
  let ssl: PoolConfig['ssl'];
  if (!local) {
    const mode = url.searchParams.get('sslmode');
    if (mode && !['require', 'verify-full'].includes(mode)) throw new Error('Cloud PostgreSQL requires verified TLS');
    for (const key of ['ssl', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) {
      if (url.searchParams.has(key)) throw new Error(`Use DATABASE_SSL_CA_FILE instead of ${key}`);
    }
    // pg's URL parser replaces ssl options when sslmode is in the URL.
    url.searchParams.delete('sslmode');
    ssl = { rejectUnauthorized: true, ...(env.DATABASE_SSL_CA_FILE ? { ca: readFileSync(env.DATABASE_SSL_CA_FILE, 'utf8') } : {}) };
  }
  return { connectionString: url.href, ssl, max, connectionTimeoutMillis: local ? 5000 : 15000, idleTimeoutMillis: env.VERCEL === '1' ? 5000 : 30000, application_name: 'qadam-delivery' };
}
