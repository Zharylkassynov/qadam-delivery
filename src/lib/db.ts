import pg, { type PoolClient } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { databaseConfig } from './db-config';

const globalDb = globalThis as unknown as { qadamPool?: pg.Pool };

export function database() {
  if (!globalDb.qadamPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required');
    globalDb.qadamPool = new pg.Pool(databaseConfig(connectionString));
    if (process.env.VERCEL === '1') attachDatabasePool(globalDb.qadamPool);
    globalDb.qadamPool.on('error', (error) => console.error('Database connection error:', 'code' in error ? error.code : 'unknown'));
  }
  return globalDb.qadamPool;
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await database().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function closeDatabase() {
  if (globalDb.qadamPool) { await globalDb.qadamPool.end(); globalDb.qadamPool = undefined; }
}
