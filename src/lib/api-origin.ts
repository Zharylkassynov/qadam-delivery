// Public configuration only. Never put credentials into the API origin.
export function apiOrigin(value: string | undefined) {
  if (!value) return '';
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('API origin must be an absolute URL'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
    throw new Error('API origin must be a single HTTPS origin (HTTP is allowed only locally)');
  }
  return url.origin;
}

export function apiPath(path: string, origin = apiOrigin(process.env.NEXT_PUBLIC_API_ORIGIN)) {
  if (!/^\/api(?:\/|\?|$)/.test(path) || path.includes('\\')) throw new Error('Expected a Qadam API path');
  return `${origin}${path}`;
}
