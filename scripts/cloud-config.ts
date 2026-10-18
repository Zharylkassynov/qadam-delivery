export function assertCloudConfig() {
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!ref || !/^[a-z]{20}$/.test(ref)) throw new Error('SUPABASE_PROJECT_REF is required');
  let url: URL;
  try { url = new URL(process.env.DATABASE_URL ?? ''); } catch { throw new Error('Cloud DATABASE_URL is required'); }
  const direct = url.hostname === `db.${ref}.supabase.co` && decodeURIComponent(url.username) === 'qadam_app';
  const pooled = url.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(url.username) === `qadam_app.${ref}`;
  if ((!direct && !pooled) || url.pathname !== '/postgres') throw new Error('Expected Supabase PostgreSQL URL with the qadam_app role');
  if (pooled && !['5432', '6543'].includes(url.port)) throw new Error('Use Session pooler on 5432 or Transaction pooler on 6543');
  if (!url.password || url.password.includes('replace_')) throw new Error('Configure the application database password');
  return { ref, host: url.hostname, poolerMode: pooled ? (url.port === '6543' ? 'transaction' : 'session') : 'direct' };
}
