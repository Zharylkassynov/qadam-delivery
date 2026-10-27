import { spawnSync } from 'node:child_process';

// Keep the existing combined deployment build, and also verify the separate API.
for (const args of [['node_modules/next/dist/bin/next', 'build'], ['scripts/apps.mjs', 'backend', 'build']]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
