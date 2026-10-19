export function readConfig(env = process.env) {
  const portText = env.PORT || '4173';
  if (!/^\d+$/.test(portText) || +portText < 1 || +portText > 65535) {
    throw new Error('PORT must be a whole number from 1 to 65535.');
  }
  const basePath = env.APP_BASE_PATH || '/apps/houston-i-love-kroger/';
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(basePath)) {
    throw new Error('APP_BASE_PATH must begin and end with / and use simple folder names.');
  }
  const environment = env.KROGER_ENVIRONMENT || 'production';
  if (!['production', 'certification'].includes(environment)) {
    throw new Error('KROGER_ENVIRONMENT must be production or certification.');
  }
  const host = env.HOST || '127.0.0.1';
  if (!/^[a-zA-Z0-9.:[\]-]+$/.test(host)) throw new Error('HOST is not a valid listening address.');
  let publicOrigin = '';
  if (env.PUBLIC_ORIGIN) {
    try {
      const url = new URL(env.PUBLIC_ORIGIN);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
          url.pathname !== '/' || url.search || url.hash) throw new Error();
      publicOrigin = url.origin;
    } catch {
      throw new Error('PUBLIC_ORIGIN must be an http(s) origin without a path or credentials.');
    }
  }
  return {
    host, port: +portText, basePath, publicOrigin, environment,
    clientId: env.KROGER_CLIENT_ID || '',
    clientSecret: env.KROGER_CLIENT_SECRET || '',
    historyDbPath: env.HISTORY_DB_PATH || undefined,
  };
}
