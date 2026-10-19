import { pathToFileURL } from 'node:url';
import { DEFAULT_PROMOTION_MAX_AGE_SECONDS, openHistoryStore } from './history-store.js';
import { createPromotionService } from './promotion-service.js';

export async function startPromotionServer({ env = process.env } = {}) {
  const token = env.PROMOTION_SERVICE_TOKEN;
  if (typeof token !== 'string' || !/^[\x21-\x7e]{32,512}$/u.test(token)) {
    throw new Error('Configure PROMOTION_SERVICE_TOKEN privately before starting the promotion service.');
  }
  const host = env.PROMOTION_SERVICE_HOST ?? '127.0.0.1';
  const portValue = env.PROMOTION_SERVICE_PORT ?? '4174';
  const freshness = env.PROMOTION_MAX_AGE_SECONDS ?? String(DEFAULT_PROMOTION_MAX_AGE_SECONDS);
  if (typeof host !== 'string' || !/^[a-zA-Z0-9.:-]{1,253}$/u.test(host) ||
      !/^\d{1,5}$/u.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535 ||
      !/^\d{1,6}$/u.test(freshness) || Number(freshness) < 1 || Number(freshness) > 604_800) {
    throw new Error('Check the promotion service listener and freshness settings.');
  }
  const store = openHistoryStore({ ...(env.HISTORY_DB_PATH ? { filename: env.HISTORY_DB_PATH } : {}) });
  const server = createPromotionService({ store, token, maxAgeSeconds: Number(freshness) });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(Number(portValue), host, () => { server.off('error', reject); resolve(); });
    });
  } catch {
    store.close();
    throw new Error('The promotion service could not listen. Check its private storage and listener configuration.');
  }
  let closing;
  return { server, close() {
    if (closing) return closing;
    closing = new Promise(resolve => {
      const deadline = setTimeout(() => server.closeAllConnections(), 1500);
      deadline.unref();
      server.close(() => { clearTimeout(deadline); store.close(); resolve(); });
    });
    return closing;
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startPromotionServer().then(runtime => {
    process.stdout.write('Private promotion service is listening. Source permission is checked separately.\n');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      runtime.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
    });
    runtime.server.on('error', () => {
      process.stderr.write('The private promotion service stopped after a listener error.\n');
      runtime.close().finally(() => { process.exitCode = 1; });
    });
  }).catch(() => {
    process.stderr.write('The private promotion service could not start. Check the private token, listener and history storage configuration.\n');
    process.exitCode = 1;
  });
}
