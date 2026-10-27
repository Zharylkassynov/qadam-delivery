import type { NextConfig } from 'next';
import { resolve } from 'node:path';
// Next's compiled config loader needs an absolute path for sibling projects.
const base = require(resolve(__dirname, '../config/next-base.ts')).default as NextConfig;

const root = resolve(__dirname, '..');
const config: NextConfig = {
  ...base, distDir: '.next', outputFileTracingRoot: root,
  turbopack: { root },
  outputFileTracingIncludes: { '/api/**/*': ['../config/certs/supabase-root.crt'] },
};
export default config;
