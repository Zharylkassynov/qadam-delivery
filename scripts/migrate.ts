import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { closeDatabase, transaction } from '../src/lib/db';

export async function migrate() {
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(62120261018)");
    await client.query('CREATE TABLE IF NOT EXISTS public.qadam_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const folder = new URL('../db/migrations/', import.meta.url);
    for (const name of (await readdir(folder)).filter((name) => name.endsWith('.sql')).sort()) {
      const sql = await readFile(new URL(name, folder), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query('SELECT checksum FROM public.qadam_migrations WHERE name=$1', [name]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`Applied migration was modified: ${name}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO public.qadam_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
      console.log(`Applied ${name}`);
    }
  });
}

// Explicit flag lets tests import the runner without launching a second migration.
if (process.argv[1]?.endsWith('migrate.ts')) {
  migrate().then(() => console.log('Database migrations ready')).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Migration failed'); process.exitCode = 1;
  }).finally(closeDatabase);
}
