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
  const flag = name => {
    const value = env[name] || 'false';
    if (!['true', 'false'].includes(value)) throw new Error(`${name} must be true or false.`);
    return value === 'true';
  };
  const cartEnabled = flag('KROGER_CART_ENABLED');
  const cartGranted = flag('KROGER_CART_GRANTED');
  const cartRedirectUri = env.KROGER_CART_REDIRECT_URI || '';
  if (cartRedirectUri) {
    try {
      const callback = new URL(cartRedirectUri);
      if (!publicOrigin || callback.protocol !== 'https:' || callback.origin !== publicOrigin || callback.username || callback.password ||
          callback.pathname !== `${basePath}api/v1/cart/callback` || callback.search || callback.hash) throw new Error();
    } catch { throw new Error('KROGER_CART_REDIRECT_URI must be the registered HTTPS callback at PUBLIC_ORIGIN and APP_BASE_PATH/api/v1/cart/callback.'); }
  }
  const promotionServiceUrl = env.PROMOTION_SERVICE_URL || '';
  const promotionServiceToken = env.PROMOTION_SERVICE_TOKEN || '';
  if (promotionServiceUrl) {
    try {
      const endpoint = new URL(promotionServiceUrl);
      if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password ||
          endpoint.pathname !== '/' || endpoint.search || endpoint.hash) throw new Error();
    } catch { throw new Error('PROMOTION_SERVICE_URL must be an http(s) service origin without a path or credentials.'); }
  }
  if (Boolean(promotionServiceUrl) !== Boolean(promotionServiceToken) || promotionServiceToken.length > 512 ||
      promotionServiceToken && promotionServiceToken.length < 32 ||
      promotionServiceToken && !/^[\x21-\x7e]+$/.test(promotionServiceToken)) {
    throw new Error('PROMOTION_SERVICE_URL and PROMOTION_SERVICE_TOKEN must both be configured with a supported private token.');
  }
  return {
    host, port: +portText, basePath, publicOrigin, environment,
    clientId: env.KROGER_CLIENT_ID || '',
    clientSecret: env.KROGER_CLIENT_SECRET || '',
    historyDbPath: env.HISTORY_DB_PATH || undefined,
    cartEnabled, cartGranted, cartRedirectUri, promotionServiceUrl, promotionServiceToken,
  };
}
