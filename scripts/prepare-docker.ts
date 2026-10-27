import { migrate } from './migrate';
import { seed } from './seed';
import { closeDatabase } from '../src/lib/db';

const target = new URL(process.env.DATABASE_URL ?? '');
if (process.env.QADAM_LOCAL_DOCKER !== 'true' || target.hostname !== 'db' || target.pathname !== '/qadam_docker' ||
    process.env.DEMO_AUTH_ENABLED !== 'true' || process.env.TELEGRAM_AUTH_ENABLED !== 'false') {
  throw new Error('Docker preparation is restricted to the isolated local demo database');
}

try {
  await migrate();
  await seed();
} finally { await closeDatabase(); }
