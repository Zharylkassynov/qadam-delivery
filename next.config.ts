import type { NextConfig } from 'next';
import { validateDeployment } from './src/lib/deployment-config';

validateDeployment();

const config: NextConfig = {
  distDir: process.env.QADAM_NEXT_DIST_DIR ?? '.next',
  poweredByHeader: false,
  devIndicators: false,
  outputFileTracingIncludes: {
    '/api/**/*': ['./config/certs/supabase-root.crt'],
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      ],
    }];
  },
};
export default config;
