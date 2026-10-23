import 'server-only';

export function getAppUrl(pathname: string): URL {
  const configured = process.env.APP_BASE_URL;
  if (!configured) throw new Error('Account links are not configured. Set APP_BASE_URL to the public application origin.');
  const base = new URL(configured);
  const localHttp = base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname);
  if ((!localHttp && base.protocol !== 'https:') || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('APP_BASE_URL must be an HTTPS origin (HTTP is allowed only for localhost).');
  }
  return new URL(pathname, base);
}
