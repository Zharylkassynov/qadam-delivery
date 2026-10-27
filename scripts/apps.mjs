import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const [app, requestedAction] = process.argv.slice(2);
if (!['backend', 'frontend'].includes(app) || !['build', 'start', 'test-start'].includes(requestedAction)) throw new Error('Choose backend/frontend and build/start');
const action = requestedAction === 'test-start' ? 'start' : requestedAction;

// Isolated builds and the frontend never inherit database or bot credentials.
const publicEnv = {};
for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE', 'HOME', 'LOCALAPPDATA', 'APPDATA', 'COMSPEC', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'OS', 'CI', 'NO_COLOR', 'FORCE_COLOR']) {
  if (process.env[name] !== undefined) publicEnv[name] = process.env[name];
}
const env = app === 'frontend' || action === 'build' ? publicEnv : { ...process.env };
env.NEXT_TELEMETRY_DISABLED = '1';
env.QADAM_STANDALONE = process.env.QADAM_STANDALONE ?? 'false';
if (app === 'frontend') {
  if (process.env.VERCEL === '1') {
    if (!process.env.NEXT_PUBLIC_API_ORIGIN) throw new Error('Set the public HTTPS API origin before deploying the frontend');
    env.VERCEL = '1';
  }
  env.QADAM_FRONTEND_ONLY = 'true';
  env.NEXT_PUBLIC_API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://127.0.0.1:3102';
  cpSync(new URL('../public/', import.meta.url), new URL('../frontend/public/', import.meta.url), { recursive: true });
} else if (action === 'start') env.QADAM_BACKEND = 'true';

function run(args, childEnv = env) {
  const result = spawnSync(process.execPath, args, { cwd: root, env: childEnv, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (requestedAction === 'test-start') {
  if (app !== 'backend' || !new URL(env.DATABASE_URL).pathname.endsWith('_test')) throw new Error('Test preparation requires an isolated _test database');
  run(['--import', 'tsx', 'scripts/prepare-e2e.ts']);
}
const args = ['node_modules/next/dist/bin/next', action, app];
if (action === 'start') args.push('--hostname', process.env.QADAM_API_BIND ?? '127.0.0.1', '--port', process.env.PORT ?? (app === 'backend' ? '3102' : '3103'));
run(args);
