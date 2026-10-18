import pg from 'pg';

const source = new URL(process.env.DATABASE_URL ?? '');
const target = new URL(process.env.TEST_DATABASE_URL ?? '');
const name = target.pathname.slice(1);
if (!/^[a-zA-Z0-9_]+_test$/.test(name) || source.pathname === target.pathname) {
  throw new Error('TEST_DATABASE_URL must identify a separate database ending in _test');
}
if (source.host !== target.host || source.username !== target.username) throw new Error('Create the test database on the same local database server');
if (!['localhost', '127.0.0.1'].includes(source.hostname)) throw new Error('Automatic test database creation is restricted to local PostgreSQL');
const client = new pg.Client({ connectionString: source.href, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  const existing = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]);
  if (!existing.rowCount) await client.query(`CREATE DATABASE "${name}"`);
  console.log('Separate test database ready');
} finally { await client.end(); }
