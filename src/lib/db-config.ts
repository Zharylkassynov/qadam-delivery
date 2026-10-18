import { readFileSync } from 'node:fs';
import type { PoolConfig } from 'pg';

export function databaseConfig(connectionString: string, env: Record<string, string | undefined> = process.env): PoolConfig {
  let url: URL;
  try { url = new URL(connectionString); } catch { throw new Error('Invalid DATABASE_URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use PostgreSQL');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
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
