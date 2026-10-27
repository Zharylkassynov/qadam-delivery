import { appOrigin } from '../src/lib/deployment-config';
import { databaseConfig } from '../src/lib/db-config';
import { apiOrigin } from '../src/lib/api-origin';

export function validateBackend(env: Record<string, string | undefined> = process.env) {
  if (env.QADAM_BACKEND !== 'true' || env.VERCEL === '1') throw new Error('Standalone backend mode is required outside Vercel');
  const frontend = new URL(appOrigin(env));
  const api = apiOrigin(env.API_ORIGIN);
  if (!api) throw new Error('API_ORIGIN is required for the standalone backend');
  const local = ['localhost', '127.0.0.1'].includes(frontend.hostname) &&
    ['localhost', '127.0.0.1'].includes(new URL(api).hostname);
  if (!local && (frontend.protocol !== 'https:' || new URL(api).protocol !== 'https:')) throw new Error('Public frontend and API origins require HTTPS');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required for the standalone backend');
  databaseConfig(env.DATABASE_URL, env);
  if (!['true', 'false'].includes(env.DEMO_AUTH_ENABLED ?? '') ||
      !['true', 'false'].includes(env.TELEGRAM_AUTH_ENABLED ?? '')) throw new Error('Set authentication modes explicitly');
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Verified TLS must not be disabled');
  if (!local && (env.QADAM_LOCAL_DOCKER === 'true' || env.DEMO_AUTH_ENABLED === 'true')) {
    throw new Error('Local Docker and demo login are restricted to local origins');
  }
  if (env.DEMO_AUTH_ENABLED === 'true' && (env.DEMO_PASSWORD?.length ?? 0) < 12) throw new Error('Local demo password is required');
  if (env.TELEGRAM_AUTH_ENABLED === 'true') {
    if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(env.TELEGRAM_BOT_TOKEN ?? '') ||
        !/^[A-Za-z0-9_-]{32,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET ?? '')) throw new Error('Telegram server credentials are required');
    if (env.TELEGRAM_WORKER_ENABLED === 'false' && !local) throw new Error('Telegram worker cannot be disabled for public origins');
  }
  if (env.TELEGRAM_WORKER_ENABLED && !['true', 'false'].includes(env.TELEGRAM_WORKER_ENABLED)) throw new Error('TELEGRAM_WORKER_ENABLED must be true or false');
}
