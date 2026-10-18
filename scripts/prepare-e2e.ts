import { migrate } from './migrate';
import { seed } from './seed';
import { closeDatabase } from '../src/lib/db';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('A separate TEST_DATABASE_URL ending in _test is required');
process.env.DATABASE_URL = url;
process.env.DEMO_AUTH_ENABLED = 'true';

try { await migrate(); await seed(); }
finally { await closeDatabase(); }
