type Environment = Record<string, string | undefined>;
import { apiOrigin } from './api-origin';

export function appOrigin(env: Environment = process.env) {
  let value = env.APP_ORIGIN;
  // Vercel supplies the exact deployment hostname; never accept wildcard origins.
  if (!value && env.VERCEL === '1' && env.VERCEL_ENV === 'preview' &&
      /^[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL ?? '')) {
    value = `https://${env.VERCEL_URL}`;
  }
  let url: URL;
  try { url = new URL(value ?? ''); } catch { throw new Error('APP_ORIGIN must be an absolute URL'); }
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || (!local && url.protocol !== 'https:') ||
      (env.VERCEL === '1' && (local || url.protocol !== 'https:' || url.port))) {
    throw new Error('APP_ORIGIN must be a single HTTPS origin (HTTP is allowed only locally)');
  }
  return url.origin;
}

export function validateDeployment(env: Environment = process.env) {
  if (env.TELEGRAM_WORKER_ENABLED && !['true','false'].includes(env.TELEGRAM_WORKER_ENABLED)) throw new Error('TELEGRAM_WORKER_ENABLED must be true or false');
  if (env.VERCEL === '1' && env.VERCEL_ENV === 'production' && env.TELEGRAM_AUTH_ENABLED === 'true' && env.TELEGRAM_WORKER_ENABLED === 'false') throw new Error('Telegram worker must be enabled in Production');
  if (env.QADAM_FRONTEND_ONLY && !['true', 'false'].includes(env.QADAM_FRONTEND_ONLY)) throw new Error('QADAM_FRONTEND_ONLY must be true or false');
  if (env.VERCEL === '1' && env.QADAM_BACKEND === 'true') throw new Error('Standalone backend mode is forbidden on Vercel');
  if (env.NEXT_PUBLIC_API_ORIGIN) apiOrigin(env.NEXT_PUBLIC_API_ORIGIN);
  if (env.QADAM_FRONTEND_ONLY === 'true') {
    const api = apiOrigin(env.NEXT_PUBLIC_API_ORIGIN);
    if (!api) throw new Error('A separate API origin is required for frontend-only builds');
    if (env.VERCEL === '1' && (new URL(api).protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(new URL(api).hostname))) {
      throw new Error('Public frontend deployments require a public HTTPS API origin');
    }
    if (env.DATABASE_URL || env.TEST_DATABASE_URL || env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_WEBHOOK_SECRET || env.GEOAPIFY_API_KEY || env.DEMO_PASSWORD) {
      throw new Error('Frontend-only deployments must not contain backend credentials');
    }
    return;
  }
  if (env.VERCEL === '1' && env.QADAM_LOCAL_DOCKER && env.QADAM_LOCAL_DOCKER !== 'false') {
    throw new Error('Local Docker database mode is forbidden on Vercel');
  }
  if (env.VERCEL !== '1') return;
  appOrigin(env);
  if (env.QADAM_NEXT_DIST_DIR && env.QADAM_NEXT_DIST_DIR !== '.next') {
    throw new Error('Vercel must use the standard .next output directory');
  }
  if (env.VERCEL_ENV === 'preview') {
    if (env.DEMO_AUTH_ENABLED === 'true' || env.DATABASE_URL || env.TELEGRAM_AUTH_ENABLED === 'true' || env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_WEBHOOK_SECRET || env.GEOAPIFY_API_KEY) {
      throw new Error('Preview must have login disabled and no database or bot credentials; scope credentials to Production');
    }
    return;
  }
  if (env.VERCEL_ENV !== 'production') throw new Error('Expected a Production or Preview Vercel build');
  if (!['true', 'false'].includes(env.DEMO_AUTH_ENABLED ?? '')) throw new Error('Set DEMO_AUTH_ENABLED explicitly');
  if (env.TELEGRAM_AUTH_ENABLED && !['true', 'false'].includes(env.TELEGRAM_AUTH_ENABLED)) throw new Error('TELEGRAM_AUTH_ENABLED must be true or false');
  if (env.TELEGRAM_AUTH_ENABLED === 'true' && !/^\d+:[A-Za-z0-9_-]{30,}$/.test(env.TELEGRAM_BOT_TOKEN ?? '')) {
    throw new Error('TELEGRAM_BOT_TOKEN is required when Telegram login is enabled');
  }
  if (env.TELEGRAM_AUTH_ENABLED === 'true' && !/^[A-Za-z0-9_-]{32,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET ?? '')) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET is required when Telegram login is enabled');
  }
  const ref = env.SUPABASE_PROJECT_REF;
  if (!ref || !/^[a-z]{20}$/.test(ref)) throw new Error('SUPABASE_PROJECT_REF is required');
  let database: URL;
  try { database = new URL(env.DATABASE_URL ?? ''); } catch { throw new Error('DATABASE_URL is required'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) ||
      !/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(database.hostname) || database.port !== '6543' ||
      decodeURIComponent(database.username) !== `qadam_app.${ref}` || database.pathname !== '/postgres' ||
      !database.password || /replace_|YOUR-PASSWORD/.test(database.password)) {
    throw new Error('Use the Supabase transaction pooler on port 6543 with the restricted qadam_app role');
  }
  if ([...database.searchParams].some(([key, value]) => key !== 'sslmode' || !['require', 'verify-full'].includes(value)) ||
      env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Verified database TLS is required');
  if (env.DATABASE_SSL_CA_FILE !== 'config/certs/supabase-root.crt') throw new Error('Use the bundled Supabase root CA file');
  const max = Number(env.DATABASE_POOL_MAX ?? '3');
  if (!Number.isInteger(max) || max < 2 || max > 10) throw new Error('DATABASE_POOL_MAX must be between 2 and 10 on Vercel');
}
