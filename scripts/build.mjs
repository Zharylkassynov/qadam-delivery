import { spawnSync } from 'node:child_process';

// Keep the existing combined deployment build, and also verify the separate API.
// Windows Turbopack can lose its PostCSS child process; use the supported Webpack build there.
const combined=['node_modules/next/dist/bin/next','build',...(process.platform==='win32'?['--webpack']:[])];
for (const args of [combined, ['scripts/apps.mjs', 'backend', 'build']]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
