import { spawnSync } from 'node:child_process';

// Test the existing deployment, then the same product against a separate API.
for (const args of [
  ['node_modules/@playwright/test/cli.js', 'test'],
  ['scripts/apps.mjs', 'frontend', 'build'],
  ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.api.config.ts'],
]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
