import { appOrigin } from './deployment-config';

export function allowedAppOrigins(env: Record<string, string | undefined> = process.env) {
  const configured = new URL(appOrigin(env));
  const origins = new Set([configured.origin]);
  if (['localhost', '127.0.0.1'].includes(configured.hostname)) {
    const alias = new URL(configured.origin);
    alias.hostname = configured.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
    origins.add(alias.origin);
  }
  return origins;
}
