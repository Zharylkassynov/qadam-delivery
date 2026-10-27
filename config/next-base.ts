import type { NextConfig } from 'next';
import { validateDeployment } from '../src/lib/deployment-config';

validateDeployment();
const config: NextConfig = {
  output: process.env.QADAM_STANDALONE === 'true' ? 'standalone' : undefined,
  distDir: process.env.QADAM_NEXT_DIST_DIR ?? '.next',
  poweredByHeader: false,
  devIndicators: false,
  outputFileTracingIncludes: { '/api/**/*': ['./config/certs/supabase-root.crt'] },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'self' https://web.telegram.org" },
    ] }];
  },
};
export default config;
