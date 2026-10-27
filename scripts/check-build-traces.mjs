import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = 'src/app/api';
const routes = readdirSync(root, { recursive: true }).filter((file) => String(file).endsWith('route.ts'));
if (!routes.length) throw new Error('No API routes found');
for (const route of routes) {
  const manifest = join(process.env.QADAM_NEXT_DIST_DIR ?? '.next', 'server/app/api', String(route).replace(/\.ts$/, '.js.nft.json'));
  const trace = JSON.parse(readFileSync(manifest, 'utf8'));
  if (!trace.files.some((file) => resolve(dirname(manifest), file) === resolve('config/certs/supabase-root.crt'))) {
    throw new Error(`Supabase root CA missing from API bundle: ${route}`);
  }
  const backendManifest = join('backend/.next/server/app/api', String(route).replace(/\.ts$/, '.js.nft.json'));
  const backendTrace = JSON.parse(readFileSync(backendManifest, 'utf8'));
  if (!backendTrace.files.some((file) => resolve(dirname(backendManifest), file) === resolve('config/certs/supabase-root.crt'))) {
    throw new Error(`Supabase root CA missing from standalone API bundle: ${route}`);
  }
}
console.log(`Verified Supabase root CA in all ${routes.length} combined and ${routes.length} standalone API bundles`);
