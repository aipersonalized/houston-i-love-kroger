import { parseArgs } from 'node:util';
import { readConfig } from './config.js';
import { KrogerClient } from './kroger.js';
import { createApp } from './app.js';
import { createPromotionClient } from './promotion-client.js';
import { createShoppingClient } from './shopping-client.js';

async function main() {
  const { values } = parseArgs({ options: {
    help: { type: 'boolean', short: 'h' }, json: { type: 'boolean' },
    'no-input': { type: 'boolean' }, 'no-color': { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Houston I Love Kroger — store product and promotion finder\n\nStart: npm start\nHelp: node src/server.js --help\nMachine status: node src/server.js --json --no-input\n\nConfigure HOST, PORT, APP_BASE_PATH, PUBLIC_ORIGIN and SHOPPING_SERVICE_URL\nin your private runtime or .env. The shared service owns Kroger reads and\nhistory. Start it separately with npm run promotions:serve.\nFor loopback-only development, explicit LOCAL_SHOPPING_MODE=true uses local\nKROGER_CLIENT_ID/KROGER_CLIENT_SECRET and optional private history settings.\nCollection is a separate operator command and requires source permission.\nCart is disabled by default. It additionally requires KROGER_CART_ENABLED,\nKROGER_CART_GRANTED and the registered HTTPS KROGER_CART_REDIRECT_URI.\nNever put credentials or service tokens on the command line.\n\nNo menus or prompts. Stop with Ctrl+C. See docs/SELF_HOSTING.md.');
    return;
  }
  const config = readConfig();
  if (!['127.0.0.1', 'localhost', '::1'].includes(config.host) && !config.publicOrigin) {
    throw new Error('Set PUBLIC_ORIGIN before listening beyond this computer. See docs/SELF_HOSTING.md.');
  }
  if (!config.shoppingServiceUrl && !config.localShoppingMode) {
    throw new Error('Set SHOPPING_SERVICE_URL to the shared shopping service. LOCAL_SHOPPING_MODE=true is only for explicit loopback development.');
  }
  const shopping = config.shoppingServiceUrl ? createShoppingClient({ url: config.shoppingServiceUrl }) : null;
  // Production shopping is owned by the service. The web process creates no
  // supplier client or database; Cart keeps its own separately enabled client.
  const client = shopping ? null : new KrogerClient(config);
  const promotion = !shopping && config.promotionServiceUrl ? createPromotionClient({
    url: config.promotionServiceUrl, token: config.promotionServiceToken,
  }) : null;
  // Remote mode never imports, opens or initializes the SQLite store. The
  // database belongs to the private service and the separate operator workflow.
  let history;
  if (!shopping && !promotion) {
    const { openHistoryStore } = await import('./history-store.js');
    history = openHistoryStore({ filename: config.historyDbPath });
  }
  let historyClosed = false;
  const closeHistory = () => { if (!historyClosed) { historyClosed = true; history?.close(); } };
  let server;
  let shutdownDeadline;
  try {
    server = await createApp({ config, client, shoppingProvider: shopping, promotionProvider: promotion,
      historyProvider: async args => {
        if (!promotion) return history.getComparisons(args);
        if (args.locationId === null && args.offers.length === 0) return { ...(await promotion.getStatus()), histories: [] };
        return promotion.getComparisons(args);
      } });
    server.once('close', () => { clearTimeout(shutdownDeadline); closeHistory(); });
    await new Promise((resolve, reject) => {
      const onError = error => reject(error);
      server.once('error', onError);
      server.listen(config.port, config.host, () => { server.off('error', onError); resolve(); });
    });
  } catch (error) { closeHistory(); throw error; }
  const output = { status: 'listening', port: config.port, basePath: config.basePath,
    shoppingBackend: shopping ? 'shared-service' : 'explicit-local',
    ...(client ? { configured: client.configured, environment: client.environment } : {}) };
  if (values.json || values['no-input'] || !process.stdout.isTTY) console.log(JSON.stringify(output));
  else console.log(`Houston I Love Kroger\nOpen http://localhost:${config.port}${config.basePath}\n${shopping ? 'Shopping uses the shared service; check API status for readiness.' : client.configured ? 'API settings loaded; live access is not yet verified.' : 'Setup needed: read docs/SELF_HOSTING.md.'}\nStop with Ctrl+C.`);
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => { process.exitCode = 0; });
    shutdownDeadline = setTimeout(() => server.closeAllConnections(), 12_000);
    shutdownDeadline.unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch(error => {
  const safeMessages = ['PORT must', 'APP_BASE_PATH must', 'KROGER_ENVIRONMENT must', 'HOST is not', 'PUBLIC_ORIGIN must',
    'KROGER_CART_ENABLED must', 'KROGER_CART_GRANTED must', 'KROGER_CART_REDIRECT_URI must', 'PROMOTION_SERVICE_URL must',
    'PROMOTION_SERVICE_URL and', 'Set PUBLIC_ORIGIN', 'Set SHOPPING_SERVICE_URL', 'SHOPPING_SERVICE_URL must',
    'LOCAL_SHOPPING_MODE must', 'LOCAL_SHOPPING_MODE requires'];
  const message = error.code === 'EADDRINUSE' ? 'That port is in use. Choose another PORT; do not stop an unrelated process.'
    : error.name === 'HistoryError' || error.code?.startsWith('SQLITE_')
      ? 'The local history database could not be opened. Check HISTORY_DB_PATH, folder permissions and the database setup in docs/SELF_HOSTING.md.'
    : safeMessages.some(prefix => error.message?.startsWith(prefix)) ? error.message
    : error.code?.startsWith('ERR_PARSE_ARGS') ? 'Unknown option. Run node src/server.js --help.'
    : 'The app could not start. Check the configuration and required files in docs/SELF_HOSTING.md.';
  console.error(JSON.stringify({ status: 'failed', message }));
  process.exitCode = 1;
});
