import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const secrets = fileURLToPath(new URL('../.secrets/docker-local.env', import.meta.url));
const action = process.argv[2];
const actions = ['up', 'down', 'check', 'logs', 'status'];
if (!actions.includes(action)) {
  console.error(`Choose one of: ${actions.join(', ')}`);
  process.exit(1);
}

function compose(...args) {
  const result = spawnSync('docker', ['compose', '--env-file', secrets, '-f', 'compose.local.yaml', ...args], {
    cwd: root, stdio: 'inherit', windowsHide: true,
  });
  if (result.error) {
    console.error('Docker is unavailable. Install and start Docker Desktop, then retry.');
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (action === 'up') {
  mkdirSync(new URL('../.secrets/', import.meta.url), { recursive: true });
  try {
    // Existing credentials must survive subsequent runs and database restarts.
    writeFileSync(secrets, `QADAM_DOCKER_PASSWORD=${randomBytes(32).toString('hex')}\nQADAM_DOCKER_DEMO_PASSWORD=${randomBytes(24).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
    console.log('Created local-only credentials in ignored .secrets/docker-local.env (values hidden).');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  compose('build', 'app', 'tools');
  compose('up', '-d', '--wait', 'db');
  compose('run', '--rm', 'tools');
  compose('up', '-d', '--wait', 'app');
  console.log('Local Qadam is ready at http://127.0.0.1:3200. Run npm run docker:check to verify persistence.');
} else if (action === 'check') {
  compose('run', '--rm', 'tools', 'node', '--import', 'tsx', 'scripts/docker-smoke.ts', 'create');
  compose('restart', 'db', 'app');
  compose('up', '-d', '--wait', 'db', 'app');
  compose('run', '--rm', 'tools', 'node', '--import', 'tsx', 'scripts/docker-smoke.ts', 'verify');
} else if (action === 'down') {
  compose('down');
  console.log('Local containers stopped. The database volume and local credentials are preserved.');
} else if (action === 'logs') {
  compose('logs', '--tail', '60', 'app');
} else {
  compose('ps');
}
