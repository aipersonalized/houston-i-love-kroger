import { AppError } from './errors.js';
import { validateStoreSearch, validateDealSearch, validateProductSearch, compareOffers, SAMPLE_TOPICS, SAMPLE_QUERY_LIMIT, SEARCH_QUERY_LIMIT } from './deals.js';
import { historyAvailability } from './history.js';
import { orderOffers, orderProducts } from '../public/ordering.js';
import { validPriceSearchRequest, validEstimateRequest } from './stored-pricing.js';
import { validDirectoryRequest, validTopicsRequest } from './store-directory.js';
import { productPageContinuation } from './product-pagination.js';
import { validateProductRetrieve, validateLiveEstimate, readSelectedProduct, estimateLiveBasket } from './live-shopping.js';

export const SHOPPING_SERVICE_ID = Object.freeze({ name: 'houston-i-love-kroger-shopping', apiVersion: 1 });
export const SHOPPING_POST_PATHS = new Set([
  "api/v1/stores/search",
  "api/v1/deals/search",
  "api/v1/products/search",
  "api/v1/products/retrieve",
  "api/v1/basket/estimate",
  "api/v1/promotions/search",
  "api/v1/promotions/retrieve",
  "api/v1/promotions/latest",
  "api/v1/promotions/prices",
  "api/v1/promotions/estimate",
  "api/v1/promotions/stores",
  "api/v1/promotions/topics"
]);
export const SHOPPING_GET_PATHS = new Set(['api/v1/status', 'api/v1/promotions/status']);

async function readHistory(provider, args, environment) {
  if (environment !== 'production') {
    const unavailable = { status: 'unavailable', reason: 'history_environment_mismatch',
      message: 'Production price history is not used with certification responses.' };
    return { ...unavailable, histories: args.offers.map(() => ({ ...unavailable })) };
  }
  if (!provider) return { ...historyAvailability(), histories: args.offers.map(() => historyAvailability()) };
  try {
    const comparison = await provider(args);
    if (!comparison || typeof comparison.status !== 'string' ||
        !Array.isArray(comparison.histories) || comparison.histories.length !== args.offers.length ||
        comparison.histories.some(value => !value || typeof value.status !== 'string')) throw new Error('Unsupported history result.');
    const result = { status: comparison.status, histories: comparison.histories };
    for (const field of ['reason', 'message']) {
      if (typeof comparison[field] === 'string') result[field] = comparison[field];
    }
    return result;
  } catch {
    // Expose history failures without hiding current-price search results or
    // converting a failed lookup into a claim that no observations exist.
    const failure = { status: 'unavailable', reason: 'history_read_failed',
      message: 'Historical comparisons could not be read. Ask the operator to check the history source.' };
    return { ...failure, histories: args.offers.map(() => ({ ...failure })) };
  }
}

// One headless operation owner for the dedicated service and explicit local mode.
// No browser assets, cookie sessions, Cart operations or collection live here.
export function createShoppingApi({ client, dataSource = 'kroger-api', now = Date.now, historyProvider, promotionProvider }) {
  const promotionsUnavailable = () => ({ status: 'unavailable', reason: 'promotion_service_not_configured',
    message: 'The operator has not connected a promotions service.' });
  const promotionStatus = async () => {
    if (client.environment !== 'production') return { status: 'unavailable', reason: 'history_environment_mismatch' };
    if (!promotionProvider) return promotionsUnavailable();
    try {
      const value = await promotionProvider.getStatus();
      const result = { status: typeof value?.status === 'string' ? value.status : 'unavailable' };
      for (const name of ['reason', 'message']) if (typeof value?.[name] === 'string') result[name] = value[name];
      return result;
    } catch { return { status: 'unavailable', reason: 'promotion_service_unavailable', message: 'The promotions service could not be reached.' }; }
  };

  return { async execute(path, body, { signal } = {}) {
    if (path === 'api/v1/status') {
      const promotionService = await promotionStatus();
      const { histories, ...history } = promotionProvider ? { ...promotionService, histories: [] }
        : await readHistory(historyProvider, { locationId: null, offers: [], asOf: new Date(now()).toISOString() }, client.environment);
      return { ok: true, apiVersion: 1, service: SHOPPING_SERVICE_ID, configured: client.configured,
        environment: client.environment, dataSource, history,
        capabilities: { products: true, basket: true, cart: false, promotionService: Boolean(promotionProvider) }, promotionService };
    }
    if (path === 'api/v1/promotions/status') return { ok: true, apiVersion: 1, ...(await promotionStatus()) };
    if (!SHOPPING_POST_PATHS.has(path)) throw new AppError('not_found', 'This operation does not exist.', 404);
    if (path.startsWith('api/v1/promotions/')) {
      const latest = path.endsWith('/latest');
      const prices = path.endsWith('/prices');
      const estimate = path.endsWith('/estimate');
      const stores = path.endsWith('/stores');
      const topics = path.endsWith('/topics');
      if (stores && !validDirectoryRequest(body) || topics && !validTopicsRequest(body)) {
        throw new AppError('invalid_request', 'Use only a five-digit ZIP for stored stores, or an exact eight-character locationId for collected topics.');
      }
      if (prices && !validPriceSearchRequest(body) || estimate && !validEstimateRequest(body)) {
        throw new AppError('invalid_request', 'Use an exact store and approved topic. Estimates accept 1–10 distinct exact items with whole-unit quantities from 1 to 99.');
      }
      const input = prices || estimate || stores || topics ? body : latest ? validateLatestDealsRequest(body) : validatePromotionRequest(body, path.endsWith('/retrieve'));
      const binding = stores ? { zipCode: input.zipCode } : { locationId: input.locationId };
      if (client.environment !== 'production') {
        return { ok: true, apiVersion: 1, status: 'unavailable', reason: 'history_environment_mismatch', ...binding };
      }
      if (!promotionProvider) return { ok: true, apiVersion: 1, ...promotionsUnavailable(), ...binding };
      let result;
      try { result = await (stores ? promotionProvider.getStoredStores(input) : topics ? promotionProvider.getStoreTopics(input)
        : prices ? promotionProvider.searchPrices(input) : estimate ? promotionProvider.estimateBasket(input)
        : latest ? promotionProvider.getLatestDeals(input)
        : path.endsWith('/retrieve') ? promotionProvider.retrievePromotion(input) : promotionProvider.searchPromotions(input)); }
      catch (error) {
        if (error?.code === 'promotion_request_invalid') throw new AppError('invalid_request', 'Check the promotion fields and use a cursor from the same search.', 400);
        throw new AppError('promotion_service_unavailable', 'The promotions service could not be read. Try again later.', 503);
      }
      return { ok: true, apiVersion: 1, ...result };
    }
    if (path === 'api/v1/products/retrieve' || path === 'api/v1/basket/estimate') {
      const estimate = path === 'api/v1/basket/estimate';
      const input = estimate ? validateLiveEstimate(body) : validateProductRetrieve(body);
      if (!client.configured) throw new AppError('setup_required', 'This installation needs a Kroger API connection. Ask its operator to finish setup.', 503);
      if (estimate) {
        const result = await estimateLiveBasket(client, input, { signal, now });
        return { ok: true, apiVersion: 1, ...result, dataSource };
      }
      const product = await readSelectedProduct(client, input, { signal });
      const qualifiedAt = now();
      const result = compareOffers([product], { now: qualifiedAt });
      const retrievedAt = new Date(qualifiedAt).toISOString();
      const { histories, ...history } = await readHistory(historyProvider, {
        locationId: input.locationId, offers: result.offers, asOf: retrievedAt,
      }, client.environment);
      result.offers.forEach((offer, index) => { offer.history = histories[index]; });
      for (const priced of result.products) if (priced.pricing.status !== 'promotion') priced.history = {
        status: 'unavailable', reason: 'current_promotion_unqualified',
        message: 'This item has no qualifying current promotion for a historical promotion comparison.',
      };
      return { ok: true, apiVersion: 1,
        scope: { locationId: input.locationId, mode: 'product', productId: input.productId, exhaustive: false,
          coverage: 'One exact product rechecked at the selected store; no complete catalog or promotion coverage.' },
        ...result, page: null, history, dataSource, retrievedAt };
    }
    const input = path.endsWith('/stores/search') ? validateStoreSearch(body)
      : path.endsWith('/products/search') ? validateProductSearch(body) : validateDealSearch(body);
    if (!client.configured) throw new AppError('setup_required', 'This installation needs a Kroger API connection. Ask its operator to finish setup.', 503);
    if (path.endsWith('/stores/search')) {
      const stores = await client.searchStores(input.zipCode, { signal });
      return { ok: true, apiVersion: 1, stores, radiusInMiles: 10,
        limit: 10, dataSource, retrievedAt: new Date(now()).toISOString() };
    } else {
      const topics = input.term === null ? [...SAMPLE_TOPICS] : [input.term];
      const perQueryLimit = input.term === null ? SAMPLE_QUERY_LIMIT : SEARCH_QUERY_LIMIT;
      const products = [];
      const queries = [];
      let page = null;
      // One explicit page per request. No traversal, accumulation or storage.
      for (const term of topics) {
        let found;
        if (input.term !== null && typeof client.searchProductPage === 'function') {
          const response = await client.searchProductPage(input.locationId, term, {
            signal, limit: perQueryLimit,
            ...(input.start === undefined ? {} : { start: input.start }),
          });
          const reported = response?.pagination;
          if (!reported || typeof reported !== 'object' || Array.isArray(reported) ||
              !['start', 'limit', 'total'].every(key => reported[key] === null || Number.isSafeInteger(reported[key]) && reported[key] >= 0) ||
              input.start !== undefined && reported.start !== null && reported.start !== input.start) {
            throw new AppError('upstream_format', 'The returned page did not match this search. Try a new search.', 502);
          }
          found = response.products;
          page = { requestedStart: input.start ?? null,
            reported: { start: reported.start, limit: reported.limit, total: reported.total },
            continuation: productPageContinuation(reported, found?.length) };
        } else {
          if (input.start !== undefined) throw new AppError('pagination_unavailable', 'This installation cannot load another page. Start a more specific search.', 503);
          found = await client.searchProducts(input.locationId, term, { signal, limit: perQueryLimit });
          if (input.term !== null) page = { requestedStart: null,
            reported: { start: null, limit: null, total: null }, continuation: { status: 'unknown', nextStart: null } };
        }
        if (!Array.isArray(found) || found.length > perQueryLimit) throw new AppError('upstream_format', 'Kroger returned an unsupported result. Try again later.', 502);
        products.push(...found);
        queries.push({ term, returnedProducts: found.length });
      }
      const qualifiedAt = now();
      const result = compareOffers(products, { now: qualifiedAt });
      const retrievedAt = new Date(qualifiedAt).toISOString();
      const { histories, ...history } = await readHistory(historyProvider, {
        locationId: input.locationId, offers: result.offers, asOf: retrievedAt,
      }, client.environment);
      result.offers.forEach((offer, index) => { offer.history = histories[index]; });
      for (const product of result.products) {
        if (product.pricing.status !== 'promotion') product.history = {
          status: 'unavailable', reason: 'current_promotion_unqualified',
          message: 'This item has no qualifying current promotion for a historical promotion comparison.',
        };
      }
      return { ok: true, apiVersion: 1,
        scope: { locationId: input.locationId, mode: input.term === null ? 'sample' : 'search',
          term: input.term, topics, queries, sort: input.sort,
          ...(path.endsWith('/products/search') ? { includeAll: input.includeAll } : {}),
          productLimit: topics.length * perQueryLimit, perQueryLimit, fulfillment: 'ais', exhaustive: false,
          coverage: input.term === null
            ? 'A bounded sample of up to 15 products each for milk, bread and eggs. This does not cover all store promotions.'
            : 'Up to 50 products matching this search. This does not cover all matching products or all store promotions.' },
        offers: orderOffers(result.offers, input.sort), summary: result.summary,
        sourceEvidence: result.sourceEvidence, page,
        ...(path.endsWith('/products/search') ? {
          products: orderProducts(input.includeAll ? result.products : result.offers, input.sort),
        } : {}),
        history, dataSource, retrievedAt };
    }
  } };
}

function validatePromotionRequest(value, retrieve) {
  const required = retrieve ? ['locationId', 'observationId'] : ['locationId'];
  const optional = retrieve ? [] : ['term', 'productId', 'itemId', 'observedFrom', 'observedTo', 'limit', 'cursor'];
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key)) ||
      required.some(key => !Object.hasOwn(value, key)) || !/^[a-zA-Z0-9]{8}$/.test(value.locationId) ||
      typeof value.locationId !== 'string') throw new AppError('invalid_request', 'Use the documented promotion search fields and exact store.');
  if (retrieve && (typeof value.observationId !== 'string' || !/^[1-9]\d{0,15}$/.test(value.observationId) ||
      !Number.isSafeInteger(Number(value.observationId)))) throw new AppError('invalid_request', 'Use the observation ID returned by promotion search.');
  for (const name of ['term', 'productId', 'itemId', 'cursor', 'observedFrom', 'observedTo']) {
    if (value[name] === undefined) continue;
    const max = name === 'cursor' ? 512 : name.startsWith('observed') ? 40 : ['productId', 'itemId'].includes(name) ? 100 : 80;
    if (typeof value[name] !== 'string' || !value[name].trim() || value[name] !== value[name].trim() || value[name].length > max || /[\p{Cc}\p{Cf}]/u.test(value[name])) throw new AppError('invalid_request', 'Use bounded text fields for promotion search.');
  }
  for (const name of ['observedFrom', 'observedTo']) {
    if (value[name] !== undefined && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value[name]) ||
        !Number.isFinite(Date.parse(value[name])) || new Date(value[name]).toISOString().replace('.000Z', 'Z') !== value[name].replace('.000Z', 'Z'))) {
      throw new AppError('invalid_request', 'Use explicit valid UTC instants for promotion date bounds.');
    }
  }
  if (value.observedFrom && value.observedTo && Date.parse(value.observedFrom) > Date.parse(value.observedTo)) throw new AppError('invalid_request', 'Promotion date bounds must begin before they end.');
  if (value.limit !== undefined && (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > 50)) throw new AppError('invalid_request', 'Use a promotion result limit from 1 to 50.');
  return value;
}

function validateLatestDealsRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['locationId', 'topic', 'limit', 'cursor'].includes(key)) ||
      typeof value.locationId !== 'string' || !/^[a-zA-Z0-9]{8}$/u.test(value.locationId) ||
      typeof value.topic !== 'string' || value.topic !== value.topic.trim() || value.topic.length < 3 ||
      value.topic.length > 80 || value.topic.split(/\s+/u).length > 8 || /[\p{Cc}\p{Cf}]/u.test(value.topic) || value.topic === '*' ||
      (value.limit !== undefined && (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > 50)) ||
      (value.cursor !== undefined && (typeof value.cursor !== 'string' || value.cursor.length > 512 ||
        !/^[a-zA-Z0-9_-]+$/u.test(value.cursor)))) {
    throw new AppError('invalid_request', 'Use an exact selected store, approved collection topic, and bounded latest-deal fields.');
  }
  return value;
}
