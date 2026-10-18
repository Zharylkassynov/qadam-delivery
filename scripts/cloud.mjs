import { spawn } from 'node:child_process';

// Load the profile in this launcher, rather than with Node's --env-file flag:
// Next build workers copy execArgv to NODE_OPTIONS, where --env-file is forbidden.
process.loadEnvFile('.env.supabase');
const [action, ...extra] = process.argv.slice(2);
const next = 'node_modules/next/dist/bin/next';
const actions = {
  dev: [next, 'dev', '--hostname', '127.0.0.1'],
  build: [next, 'build'],
  start: [next, 'start', '--hostname', '127.0.0.1'],
  check: ['--import', 'tsx', 'scripts/check-cloud.ts'],
  'check:transaction': ['--import', 'tsx', 'scripts/check-cloud.ts'],
  test: ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.cloud.config.ts'],
  'test:transaction': ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.cloud.config.ts'],
};
if (!Object.hasOwn(actions, action)) throw new Error('Use dev, build, start, check, test, check:transaction or test:transaction');
if (action.endsWith(':transaction')) {
  const database = new URL(process.env.DATABASE_URL ?? '');
  if (!/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(database.hostname) || !['5432', '6543'].includes(database.port)) {
    throw new Error('Transaction checks require the existing Supabase shared pooler configuration');
  }
  database.port = '6543';
  process.env.DATABASE_URL = database.href;
}
if (['dev', 'start'].includes(action) && !extra.some((arg) => arg === '--port' || arg === '-p' || arg.startsWith('--port='))) {
  extra.push('--port', new URL(process.env.APP_ORIGIN ?? 'http://127.0.0.1:3001').port || '3001');
}
const child = spawn(process.execPath, [...actions[action], ...extra], { stdio: 'inherit', env: process.env, windowsHide: true });
child.on('error', () => { console.error('Could not launch cloud command'); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
