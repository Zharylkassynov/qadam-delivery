// Creates an ignored runtime config and exports SQL for the Supabase management
// connector. Only password verifiers/hashes enter the SQL; plaintext stays local.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { hashPassword } from '../src/lib/auth';

const ref = process.argv.find((arg) => arg.startsWith('--project='))?.slice(10);
if (!ref || !/^[a-z0-9]{20}$/.test(ref)) throw new Error('Pass --project=<Supabase project ref>');
if (!existsSync('.env.supabase')) {
  const password = randomBytes(32).toString('hex');
  writeFileSync('.env.supabase', [
    `SUPABASE_PROJECT_REF=${ref}`,
    `DATABASE_URL=postgresql://qadam_app:${password}@db.${ref}.supabase.co:5432/postgres`,
    'DATABASE_POOL_MAX=3', 'QADAM_NEXT_DIST_DIR=.next-cloud', 'DATABASE_SSL_CA_FILE=config/certs/supabase-root.crt', 'DEMO_AUTH_ENABLED=true',
    'DEMO_PASSWORD=QadamDemo-2026!', 'APP_ORIGIN=http://127.0.0.1:3001', '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
}
const env = parseEnv(readFileSync('.env.supabase', 'utf8'));
if (env.SUPABASE_PROJECT_REF !== ref) throw new Error('Existing cloud configuration points to another project');
if (!env.DATABASE_URL || !env.DEMO_PASSWORD) throw new Error('Cloud database URL and demo password must be configured');
const password = decodeURIComponent(new URL(env.DATABASE_URL).password);
if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('Expected generated application password');
const salt = randomBytes(16);
const salted = pbkdf2Sync(password, salt, 4096, 32, 'sha256');
const clientKey = createHmac('sha256', salted).update('Client Key').digest();
const storedKey = createHash('sha256').update(clientKey).digest('base64');
const serverKey = createHmac('sha256', salted).update('Server Key').digest('base64');
const verifier = `SCRAM-SHA-256$4096:${salt.toString('base64')}$${storedKey}:${serverKey}`;
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const migrations = readdirSync('db/migrations').filter((name) => name.endsWith('.sql')).sort().map((name) => {
  const sql = readFileSync(`db/migrations/${name}`, 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  return { name: name.replace('.sql', ''), sql: `CREATE TABLE IF NOT EXISTS public.qadam_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());\n${sql}\nINSERT INTO public.qadam_migrations(name,checksum) VALUES(${literal(name)},${literal(checksum)});` };
});
const roleSql = `CREATE ROLE qadam_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS CONNECTION LIMIT 10 PASSWORD ${literal(verifier)};
GRANT CONNECT ON DATABASE postgres TO qadam_app;
GRANT USAGE ON SCHEMA qadam TO qadam_app;
GRANT SELECT ON qadam.users TO qadam_app;
GRANT SELECT,INSERT,UPDATE ON qadam.orders TO qadam_app;
GRANT SELECT,INSERT ON qadam.order_events TO qadam_app;
GRANT SELECT,INSERT,DELETE ON qadam.sessions TO qadam_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON qadam.login_attempts TO qadam_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA qadam TO qadam_app;`;
const rows: string[] = [];
for (const role of ['CUSTOMER', 'COURIER']) {
  for (let i = 1; i <= 3; i++) {
    const customer = role === 'CUSTOMER';
    const fields = [`${customer ? 'customer' : 'courier'}${i}@qadam.demo`, `${customer ? 'Клиент' : 'Курьер'} ${i}`, role, await hashPassword(env.DEMO_PASSWORD)];
    rows.push(`(${fields.map(literal).join(',')})`);
  }
}
const seedSql = `INSERT INTO qadam.users(email,name,role,password_hash) VALUES ${rows.join(',')} ON CONFLICT(email) DO NOTHING;`;
console.log(JSON.stringify({ migrations, roleSql, seedSql }));
